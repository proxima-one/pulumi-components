import {
  ComputeResources,
  ServiceDeployParameters, Storage,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import * as yaml from "js-yaml";
import { strict as assert } from "assert";
import { WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";

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

    const appendDbDataPath = "/append-db/data";
    const appendDbIndexPath = "/append-db/index";

    const config = pulumi
      .all<any>({
        server: {
          host: "0.0.0.0",
          port: 50051,
          metricsPort: 2112,
        },
        storage: {
          appendDbDataPath: appendDbDataPath,
          appendDbIndexPath: appendDbIndexPath,
        },
        relayer: relaySection,
      })
      .apply((json) => yaml.dump(json, { indent: 2 }));

    const pvcs = pulumi.output(app.appendDb).apply(appendDb => [
      {
        name: `data-storage`,
        storage: appendDb.dataStorage,
        path: appendDbDataPath,
      },
      {
        name: `index-storage`,
        storage: appendDb.indexStorage,
        path: appendDbIndexPath,
      },
    ]);

    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      imageName: imageName,
      parts: {
        "stream-db": {
          configFiles: [{ path: "/app/config.yml", content: config }],
          resources: app.resources ?? "50m/2000m,300Mi/6Gi",
          args: app.relayFrom ? ["--readonly"] : [],
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

    const streamDb = webService.parts["stream-db"];

    const connectionDetails = pulumi
      .all([streamDb.internalHost])
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
  appendDb: {
    dataStorage: pulumi.Input<Storage>;
    indexStorage: pulumi.Input<Storage>;
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
