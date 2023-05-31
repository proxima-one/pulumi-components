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
import { DbSettings } from "./evmIndexer";
import { PasswordResolver } from "../helpers";

export class BlockIndexerDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;
  private readonly mongoDeployer: MongoDeployer;

  public constructor(params: ServiceDeployParameters) {
    this.webServiceDeployer = new WebServiceDeployer(params);
    this.mongoDeployer = new MongoDeployer(params);
  }

  public deploy(app: BlockIndexer): DeployedBlockIndexer {
    const PORT = 50051;
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
          database: "evm-indexer",
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

    const config = pulumi
      .all({
        db: {
          uri: db.endpoint,
          database: db.name,
        },
        grpc: {
          host: "0.0.0.0",
          port: PORT,
          metricsPort: 2112,
          authToken: passwords.resolve(auth.password),
        },
        network: {
          name: app.network.name,
          "finality-depth": app.network.finalityDepth ?? 1000,
          "finality-delay": app.network.finalityDelay ?? 600,
          "poll-interval":  app.network.pollInterval ?? 2000,
        },
        source: {
          "block-providers":
            app.connection.type == "legacy-db"
              ? [
                  {
                    type: "mongodb",
                    uri: app.connection.uri,
                    database: app.connection.database,
                  },
                ]
              : [
                  {
                    type: "rpc",
                    http: app.connection.http,
                    wss: app.connection.wss,
                  },
                ],
        },
      })
      .apply((json) => yaml.dump(json, { indent: 2 }));

    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      configFiles: [{ path: "/app/config.yaml", content: config }],
      imageName: app.imageName,
      parts: {
        server: {
          resources: app.server?.resources ?? "50m/2000m,300Mi/3Gi",
          env: {},
          args: ["--config", "/app/config.yaml", "server"],
          deployStrategy: {
            type: "Recreate",
          },
          metrics: {
            labels: {
              env: app.env ?? "dev",
              app: app.name,
              serviceType: "evm-indexer",
            },
          },
          ports: [
            {
              name: "http-metrics",
              containerPort: 2112,
            },
            {
              name: "api",
              containerPort: PORT,
              ingress: app.publicHost
                ? {
                    protocol: "grpc",
                    overrideHost: [app.publicHost],
                  }
                : undefined,
            },
          ],
        },
        indexer: {
          resources: app.indexer?.resources ?? "50m/2000m,300Mi/1Gi",
          env: {},
          args: ["--config", "/app/config.yaml", "indexer"],
          metrics: {
            labels: {
              env: app.env ?? "dev",
              app: app.name,
              serviceType: "evm-indexer",
            },
          },
        },
      },
    });

    const serverPart = webService.parts["server"];

    const connectionDetails = pulumi
      .all([serverPart.internalHost, passwords.resolve(auth.password)])
      .apply(([host, pass]) => {
        assert(host);
        return {
          authToken: pass,
          endpoint: `${host}:${PORT}`,
        };
      });

    const publicConnectionDetails = app.publicHost
      ? pulumi
          .all([
            pulumi.Output.create(app.publicHost),
            passwords.resolve(auth.password),
          ])
          .apply(([publicHost, pass]) => {
            return {
              authToken: pass,
              endpoint: `${publicHost}:443`,
            };
          })
      : undefined;

    return {
      type: "block-indexer",
      name: app.name,
      params: {
        connectionDetails: connectionDetails,
        publicConnectionDetails: publicConnectionDetails,
      },
    };
  }
}

export interface BlockIndexer {
  name: string;
  db: pulumi.Input<DbSettings>;
  auth?: {
    password: Password;
  };
  connection:
    | {
        type: "node";
        http: pulumi.Input<string>;
        wss?: pulumi.Input<string>;
      }
    | {
        type: "legacy-db";
        uri: pulumi.Input<string>;
        database: pulumi.Input<string>;
      };
  indexer?: {
    resources?: pulumi.Input<ComputeResources>;
  };
  server?: {
    resources?: pulumi.Input<ComputeResources>;
  };
  publicHost?: pulumi.Input<string>;
  imageName: pulumi.Input<string>;
  env?: pulumi.Input<string>;

  network: {
    name: pulumi.Input<string>;
    finalityDepth?: pulumi.Input<string>;
    finalityDelay?: pulumi.Input<string>;
    pollInterval?: pulumi.Input<string>;
  }
}

export interface DeployedBlockIndexer {
  type: "block-indexer";
  name: string;
  params: BlockIndexerParams;
}

export interface BlockIndexerParams {
  connectionDetails: pulumi.Output<BlockIndexerConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<BlockIndexerConnectionDetails>;
}

export interface BlockIndexerConnectionDetails {
  endpoint: string;
  authToken: string;
}
