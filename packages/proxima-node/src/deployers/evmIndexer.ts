import {
  ComputeResources,
  ServiceDeployParameters,
  Storage,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import { Password } from "../components/types";
import * as yaml from "js-yaml";
import { strict as assert } from "assert";
import { DeployedServiceApp, WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";
import { PasswordResolver } from "../helpers";

export class EvmIndexerDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;
  private readonly mongoDeployer: MongoDeployer;

  public constructor(params: ServiceDeployParameters) {
    this.webServiceDeployer = new WebServiceDeployer(params);
    this.mongoDeployer = new MongoDeployer(params);
  }

  public deploy(app: EvmIndexer): DeployedEvmIndexer {
    if (!app.connection.http && !app.connection.wss) {
      throw new Error(
        "Invalid arguments: at least one argument of http.url or ws.url should be specified."
      );
    }
    const imageName =
      app.imageName ??
      "quay.io/proxima.one/services:rpc-indexer-api-0.0.2-19a39c8";
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
        version: "4.4",
      });

      return {
        name: mongo.connectionDetails.database,
        endpoint: mongo.connectionDetails.endpoint,
      };
    });

    const config = pulumi.all(
      {
        storage: {
          type: "MongoDB",
          compress: "zlib",
          uri: db.endpoint,
          database: db.name,
        },
        server: {
          host: "0.0.0.0",
          port: 50052,
          metricsPort: 2112,
          superUserToken: passwords.resolve(auth.password),
        },
        "rpc-endpoint": {
          http: app.connection.http,
          ws: app.connection.wss,
        },
        logging: true,
        "goroutines-limit": 20,
      }
    ).apply(json => yaml.dump(json, { indent: 2}));

    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      configFiles: [{ path: "/app/config.yaml", content: config }],
      imageName: imageName,
      parts: {
        api: {
          resources: app.resources ?? "50m/2000m,300Mi/6Gi",
          env: {},
          args: ["--config", "/app/config.yaml", "--indexer", "--server"],
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
              containerPort: 50052,
              ingress: app.publicHost
                ? {
                    protocol: "grpc",
                    overrideHost: [app.publicHost],
                  }
                : undefined,
            },
          ],
        },
      },
    });

    const apiPart = webService.parts["api"];

    const connectionDetails = pulumi
      .all([
        webService.namespace,
        apiPart.service,
        passwords.resolve(auth.password),
      ])
      .apply(([ns, svc, pass]) => {
        assert(svc);
        return {
          authToken: pass,
          endpoint: `${svc.metadata.name}.${ns}.svc.cluster.local:${50052}`,
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
              endpoint: `${publicHost}:433`,
            };
          })
      : undefined;

    return {
      ...webService,
      connectionDetails,
      publicConnectionDetails,
    };
  }
}

export interface EvmIndexer {
  name: string;
  db: pulumi.Input<DbSettings>;
  auth?: {
    password: Password;
  };
  connection: {
    http?: pulumi.Input<string>;
    wss?: pulumi.Input<string>;
  };
  resources?: pulumi.Input<ComputeResources>;
  publicHost?: pulumi.Input<string>;
  imageName?: pulumi.Input<string>;
  env?: pulumi.Input<string>;
}

export type DbSettings =
  | { type: "import"; endpoint: string; name: string }
  | {
      type: "provision";
      params: ProvisionMongoDbParams;
    };

export interface ProvisionMongoDbParams {
  resource: ComputeResources;
  storage: Storage;
}

export interface DeployedEvmIndexer extends DeployedServiceApp {
  connectionDetails: pulumi.Output<EvmIndexerConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<EvmIndexerConnectionDetails>;
}

export interface EvmIndexerConnectionDetails {
  endpoint: string;
  authToken: string;
}
