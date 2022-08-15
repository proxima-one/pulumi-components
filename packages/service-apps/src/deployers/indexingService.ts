import * as pulumi from "@pulumi/pulumi";
import {
  AppDeployerBase,
  ComputeResources,
  DeploymentParameters,
} from "./base";
import { WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";
import { MongoDbStorage } from "@proxima-one/pulumi-proxima-node";

export class IndexingServiceDeployer extends AppDeployerBase {
  private webService: WebServiceDeployer;
  private mongo: MongoDeployer;

  public constructor(params: DeploymentParameters) {
    super(params);

    this.webService = new WebServiceDeployer(params);
    this.mongo = new MongoDeployer(params);
  }

  public deploy(app: IndexingServiceApp): DeployedIndexingService {
    const name = app.name ?? this.project;
    const dbName = app.db.name ?? "proxima";

    const db = app.db.endpoint;
    let mongoUri = this.deployOptions.cloudMongoDb.uri;

    if (db.type == "provision") {
      const mongo = this.mongo.deploy({
        storage: db.storage,
        name: `${name}-db`,
        webUI: true,
        resources: db.resources,
        version: "4.4",
        auth: {
          user: "proxima",
          password: { type: "random", name: `${name}-db` },
          database: dbName,
        },
      });

      mongoUri = mongo.connectionDetails.endpoint;
    }

    const env = pulumi.all({
      CONSUME_STREAM_IDS: app.stream,
      CONSUME_STREAM_ID: app.stream,
      MONGO_DB_NAMES: dbName,
      MONGO_DB_NAME: dbName,
      MONGO_URI: mongoUri,
      FAST_SYNC_MODE: "false",
      METRICS_SHARD_ID: pulumi
        .output(app.network)
        .apply((x) => x.toUpperCase().replace(/—/g, "_") + "_EVENTS"),
      METRICS_PORT: "2112",
    });

    const consumerEnv = {
      CONSUME_HOST: "streams.proxima.one",
      CONSUME_PORT: "443",
    };

    const serverEnv = {
      PORT: "27000",
      HTTP_PORT: "8080",
    };

    const metricsLabels = {
      env: this.env,
      index: name,
      shard: app.network,
    };
    const resoures = pulumi.output(app.resources);
    const deployedWebService = this.webService.deploy({
      name: app.name,
      imageName: app.imageName,
      parts: {
        consumer: {
          env: env.apply((x) => ({ ...x, ...consumerEnv })),
          args: ["consumer"],
          resources: resoures.apply((x) => x?.consumer),
          metrics: {
            labels: metricsLabels,
          },
          ports: [
            {
              name: "http-metrics",
              containerPort: 2112,
            },
          ],
        },
        server: {
          env: env.apply((x) => ({ ...x, ...serverEnv })),
          args: ["server"],
          resources: resoures.apply((x) => x?.server),
          metrics: {
            labels: metricsLabels,
          },
          ports: [
            {
              name: "http-metrics",
              containerPort: 2112,
            },
            {
              name: "http",
              containerPort: 8080,
              ingress: {
                protocol: "http",
                subDomain: `${name}-rest`,
              },
            },
            {
              name: "grpc",
              containerPort: 27000,
              ingress: {
                protocol: "grpc",
                subDomain: name,
              },
            },
          ],
        },
      },
    });

    const serviceMetadata = deployedWebService.parts["server"].service.apply(
      (x) => x!.metadata
    );
    return {
      name: pulumi.output(name),
      networks: pulumi.output(app.network).apply((x) => [x]),
      endpoint: this.publicHost.apply((x) => `${name}.${x}:443`),
      internalEndpoint: serviceMetadata.apply(
        (x) => `${x.name}.${x.namespace}.svc.cluster.local:27000`
      ),
    };
  }
}

export type IndexingServiceApp = IndexingServiceAppV1 & { name?: string };

export interface IndexingServiceAppV1 {
  apiKind: "indexing-service/v1";

  imageName?: pulumi.Input<string>;
  resources?: pulumi.Input<{
    consumer?: pulumi.Input<ComputeResources>;
    server?: pulumi.Input<ComputeResources>;
  }>;
  network: pulumi.Input<string>;
  stream: pulumi.Input<string>;
  db: {
    name?: string;
    endpoint:
      | { type: "cloud" }
      | ({ type: "provision" } & {
          storage: pulumi.Input<MongoDbStorage>;
          resources?: pulumi.Input<ComputeResources>;
        });
  };
}

export interface DeployedIndexingService {
  name: pulumi.Output<string>;
  networks: pulumi.Output<string[]>;
  internalEndpoint: pulumi.Output<string>;
  endpoint: pulumi.Output<string>;
}
