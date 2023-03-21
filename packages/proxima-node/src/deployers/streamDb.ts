import {
  ComputeResources,
  ServiceDeployParameters,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import { Password } from "../components/types";
import * as yaml from "js-yaml";
import { strict as assert } from "assert";
import { WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";
import { PasswordResolver } from "../helpers";
import { DbSettings } from "@proxima-one/pulumi-proxima-node";

export class StreamDbDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;
  private readonly mongoDeployer: MongoDeployer;

  public constructor(params: ServiceDeployParameters) {
    this.webServiceDeployer = new WebServiceDeployer(params);
    this.mongoDeployer = new MongoDeployer(params);
  }

  public deploy(app: StreamDb): DeployedStreamDb {
    const imageName = app.imageName ?? "quay.io/proxima.one/streamdb:0.1.1";
    const passwords = new PasswordResolver();

    const auth = app.auth ?? {
      password: { type: "random", name: app.name, length: 32 },
    };

    const db = pulumi.output(app.db).apply((db) => {
      if (db.type == "import") return { endpoint: db.endpoint, name: db.name };

      const mongo = this.mongoDeployer.deploy({
        name: app.name,
        storage: db.params.storage,
        resources: db.params.resource,
        auth: {
          user: "proxima",
          password: { type: "random", name: `${app.name}-mongo`, length: 32 },
          database: "eventstore",
        },
        webUI: db.params.webUI !== undefined,
        publicHost: db.params.webUI
          ? pulumi.output(db.params.webUI).apply((x) => x.publicHost)
          : undefined,
        version: "4.4",
      });

      return {
        name: mongo.connectionDetails.database,
        endpoint: mongo.connectionDetails.endpoint,
      };
    });

    const relaySection = pulumi.output(app.relayFrom).apply((relayFrom) => {
      if (!relayFrom) return undefined;

      return {
        pollingIntervalMs: 5 * 60 * 1000,
        streams: pulumi
          .all(relayFrom)
          .apply((x) =>
            x.map((relay, idx) => [
              `stream_${idx}`,
              {
                wildcardPatterns: relay.streams,
                connectTo: relay.remote,
              },
            ])
          )
          .apply((arr) => Object.fromEntries(arr)),
      };
    });

    const commonConfig = {
      server: {
        host: "0.0.0.0",
        port: 50051,
        metricsPort: 2112,
      },
      storage: {
        connectionString: db.endpoint,
        db: db.name,
        compression: "zlib",
      },
    };

    const apiConfig = pulumi
      .all<any>({
        ...commonConfig,
      })
      .apply((json) => yaml.dump(json, { indent: 2 }));

    const relayConfig = pulumi
      .all<any>({
        ...commonConfig,
        relayer: relaySection,
      })
      .apply((json) => yaml.dump(json, { indent: 2 }));

    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      imageName: imageName,
      parts: {
        worker: {
          disabled: app.relayFrom == undefined,
          configFiles: [{ path: "/app/config.yml", content: relayConfig }],
          env: {
            STREAMING_BATCH_SIZE: "500",
            STREAMING_SLEEP_INTERVAL: "50",
          },
          resources: app.resources ?? "50m/2000m,300Mi/6Gi",
          deployStrategy: {
            type: "Recreate",
          },
        },
        api: {
          configFiles: [{ path: "/app/config.yml", content: apiConfig }],
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
        },
      },
    });

    const apiPart = webService.parts["api"];

    const connectionDetails = pulumi
      .all([apiPart.internalHost, passwords.resolve(auth.password)])
      .apply(([host, pass]) => {
        assert(host);
        return {
          authToken: pass,
          endpoint: `${host}:${50051}`,
          httpEndpoint: `${host}:${8080}`,
        };
      });

    const publicConnectionDetails = app.publicHost
      ? pulumi
        .all([
          pulumi.Output.create(app.publicHost),
          pulumi.Output.create(app.publicHostHttp),
          passwords.resolve(auth.password),
        ])
        .apply(([publicHost, publicHostHttp, pass]) => {
          return {
            authToken: pass,
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

export interface StreamDb {
  name: string;
  db: pulumi.Input<DbSettings>;
  auth?: {
    password: Password;
  };
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

export interface DeployedStreamDbParams {
  connectionDetails: pulumi.Output<StreamDbConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<StreamDbConnectionDetails>;
}

export interface StreamDbConnectionDetails {
  endpoint: string;
  authToken: string;
}

export interface DeployedStreamDb {
  name: string;
  type: "stream-db";
  params: DeployedStreamDbParams;
}
