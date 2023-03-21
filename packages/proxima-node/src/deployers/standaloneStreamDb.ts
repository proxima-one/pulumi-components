import {
  ComputeResources,
  ServiceDeployParameters, Storage,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import { Password } from "../components/types";
import * as yaml from "js-yaml";
import { strict as assert } from "assert";
import { WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";
import { PasswordResolver } from "../helpers";

export class StandaloneStreamDbDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;
  private readonly mongoDeployer: MongoDeployer;

  public constructor(params: ServiceDeployParameters) {
    this.webServiceDeployer = new WebServiceDeployer(params);
    this.mongoDeployer = new MongoDeployer(params);
  }

  public deploy(app: StandaloneStreamDb): DeployedStandaloneStreamDb {
    const imageName = app.imageName ?? "quay.io/proxima.one/streamdb:1.0.0" ;

    const relaySection = pulumi.output(app.relayFrom).apply(relayFrom => {
      if (!relayFrom) return undefined;

      return {
        pollingIntervalMs: 5 * 60 * 1000,
        streams: Object.fromEntries(
          relayFrom.map((relay, idx) => [
            `group_${idx}`,
            {
              wildcardPatterns: relay.streams,
              connectTo: relay.remote,
            },
          ])
        )
      };
    });

    const config = pulumi
      .all<any>({
        server: {
          host: "0.0.0.0",
          port: 50051,
          metricsPort: 2112,
        },
        storage: {
          appendDbDataPath: app.appendDbStorage.data.path,
          appendDbIndexPath: app.appendDbStorage.index.path,
        },
        relayer: relaySection,
      })
      .apply((json) => yaml.dump(json, { indent: 2 }));

    const pvcs = pulumi.output(app.appendDbStorage).apply(appendDbStorage => [
      {
        name: `${app.name}-append-db-data-storage`,
        storage: appendDbStorage.data.storage,
        path: appendDbStorage.data.path,
      },
      {
        name: `${app.name}-append-db-index-storage`,
        storage: appendDbStorage.index.storage,
        path: appendDbStorage.index.path,
      },
    ]);

    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      imageName: imageName,
      parts: {
        api: {
          configFiles: [{ path: "/app/config.yml", content: config }],
          resources: app.resources ?? "50m/2000m,300Mi/6Gi",
          args: [...(app.relayFrom ? ["--readonly"] : [])],
          metrics: {
            labels: {
              env: app.env ?? "dev",
              app: app.name,
              serviceType: "stream-db",
            },
          },
          scale: app.scale,
          ports: [
            {
              name: "http-metrics",
              containerPort: 2112,
            },
            {
              name: "api-grpc",
              containerPort: 50051,
              ingress: app.publicHost
                ? {
                  protocol: "grpc",
                  overrideHost: [app.publicHost],
                }
                : undefined,
            },
            {
              name: "api-http",
              containerPort: 8080,
              ingress: app.publicHostHttp
                ? {
                  protocol: "http",
                  enableCors: true,
                  overrideHost: [app.publicHostHttp],
                }
                : undefined,
            },
          ],
          pvcs: pvcs,
        },
      },
    });

    const apiPart = webService.parts["api"];

    const connectionDetails = pulumi
      .all([apiPart.internalHost])
      .apply(([host]) => {
        assert(host);
        return {
          endpoint: `${host}:${50051}`,
          httpEndpoint: `${host}:${8080}`,
        };
      });

    const publicConnectionDetails = app.publicHost
      ? pulumi
        .all([
          pulumi.Output.create(app.publicHost),
          pulumi.Output.create(app.publicHostHttp),
        ])
        .apply(([publicHost, publicHostHttp]) => {
          return {
            endpoint: `${publicHost}:443`,
            httpEndpoint: `${publicHostHttp}:443`,
          };
        })
      : undefined;

    return {
      name: app.name,
      type: "stream-db",
      params: {
        connectionDetails,
        publicConnectionDetails,
      },
    };
  }
}

export interface StandaloneStreamDb {
  name: string;
  appendDbStorage: {
    data: {
      path: pulumi.Input<string>;
      storage: pulumi.Input<Storage>;
    };
    index: {
      path: pulumi.Input<string>;
      storage: pulumi.Input<Storage>;
    }
  }
  resources?: pulumi.Input<ComputeResources>;
  publicHost?: pulumi.Input<string>;
  publicHostHttp?: pulumi.Input<string>;
  imageName?: pulumi.Input<string>;
  env?: pulumi.Input<string>;
  relayFrom?: pulumi.Input<
    pulumi.Input<
      {
        remote: pulumi.Input<string>;
        streams: pulumi.Input<pulumi.Input<string[]>>;
      }[]
    >
  >;
  scale?: pulumi.Input<number>;
}

export interface DeployedStandaloneStreamDbParams {
  connectionDetails: pulumi.Output<StandaloneStreamDbConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<StandaloneStreamDbConnectionDetails>;
}

export interface StandaloneStreamDbConnectionDetails {
  endpoint: string;
}

export interface DeployedStandaloneStreamDb {
  name: string;
  type: "stream-db";
  params: DeployedStandaloneStreamDbParams;
}
