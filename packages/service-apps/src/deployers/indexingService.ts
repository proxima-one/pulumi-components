import * as pulumi from "@pulumi/pulumi";
import {
  AppDeployerBase,
  ComputeResources,
  DeploymentParameters,
} from "./base";
import { WebServiceDeployer, ConfigFile } from "./webService";
import { MongoDeployer } from "./mongo";
import { MongoDbStorage } from "@proxima-one/pulumi-proxima-node";
import {parseInt} from "lodash";
import * as yaml from "js-yaml";

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
    const indexName = app.indexName ?? this.project;
    const dbName = app.db.name ?? "proxima";
    const mode = app.mode ?? "live";

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

    switch (app.apiKind) {
      case "indexing-service/v1": {
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

        const consumerEnv: Record<string, string> = {
          CONSUME_HOST: "streams.proxima.one",
          CONSUME_PORT: "443",
        };

        if (mode == "fast-sync") consumerEnv["FAST_SYNC_MODE"] = "true";

        const serverEnv = {
          PORT: "27000",
          GRPC_PORT: "27000",
          HTTP_PORT: "8080",
        };

        const metricsLabels = {
          env: this.env,
          index: indexName,
          shard: app.network,
        };

        const resources = pulumi.output(app.resources);
        const deployedWebService = this.webService.deploy({
          name: app.name,
          imageName: app.imageName,
          parts: {
            consumer: {
              disabled: mode == "server-only",
              env: env.apply((x) => ({...x, ...consumerEnv})),
              args: ["./consumer"],
              resources: resources.apply((x) => x?.consumer),
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
              disabled: mode == "consumer-only" || mode == "fast-sync",
              env: env.apply((x) => ({...x, ...serverEnv})),
              args: ["./server"],
              resources: resources.apply((x) => x?.server),
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

        const deployedServer = deployedWebService.parts["server"];
        const serviceMetadata = deployedServer
          ? deployedServer.service.apply((x) => x!.metadata)
          : undefined;
        return {
          name: pulumi.output(name),
          networks: pulumi.output(app.network).apply((x) => [x]),
          endpoint: this.publicHost.apply((x) => `${name}.${x}:443`),
          internalEndpoint: serviceMetadata
            ? serviceMetadata.apply(
              (x) => `${x.name}.${x.namespace}.svc.cluster.local:27000`
            )
            : undefined,
        };
      }

      case "indexing-service/v2": {
        const env = pulumi.all({
          MODE: app.mode ?? "live",
          METRICS_PORT: "2112",
        });

        const consumerEnv: Record<string, string> = {
          CONSUME_HOST: "streams.proxima.one",
          CONSUME_PORT: "443",
        };

        const serverEnv = {
          PORT: "27000",
          GRPC_PORT: "27000",
          HTTP_PORT: "8080",
        };

        const metricsLabels = {
          env: this.env,
          index: indexName,
          shard: app.shardName,
        };

        const configs: ConfigFile[] = [{
          path: "/app/config/config.yaml",
          content: mongoUri.apply(uri => yaml.dump({
            streams: app.streams,
            timeRange: app.timeRange ? parseTimeRange(app.timeRange) : undefined,
            target: {
              dbUri: uri,
              dbName: dbName,
            },
            shard: {
              name: app.shardName
            },
          }))
        }]
        if (app.configFiles) {
          configs.push(...app.configFiles)
        }

        const resources = pulumi.output(app.resources);
        const deployedWebService = this.webService.deploy({
          name: app.name,
          imageName: app.imageName,
          configFiles: configs,
          parts: {
            consumer: {
              disabled: mode == "server-only",
              env: env.apply((x) => ({...x, ...consumerEnv})),
              args: ["./consumer"],
              resources: resources.apply((x) => x?.consumer),
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
              disabled: mode == "consumer-only" || mode == "fast-sync",
              env: env.apply((x) => ({...x, ...serverEnv})),
              args: ["./server"],
              resources: resources.apply((x) => x?.server),
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

        const deployedServer = deployedWebService.parts["server"];
        const serviceMetadata = deployedServer
          ? deployedServer.service.apply((x) => x!.metadata)
          : undefined;
        return {
          name: pulumi.output(name),
          networks: pulumi.output([...new Set<string>(  // unique networks from all streams
            Object.entries(app.streams).reduce<string[]>((acc, cur) => {
              return acc.concat(cur[1].reduce<string[]>((acc, cur) => {
                return cur.metadata?.networks ? acc.concat(cur.metadata?.networks) : acc
              }, []))
            }, [])
          )]),
          endpoint: this.publicHost.apply((x) => `${name}.${x}:443`),
          internalEndpoint: serviceMetadata
            ? serviceMetadata.apply(
              (x) => `${x.name}.${x.namespace}.svc.cluster.local:27000`
            )
            : undefined,
        };
      }
    }
  }
}

export type IndexingServiceApp = (IndexingServiceAppV1 | IndexingServiceAppV2) & { name?: string };

export interface IndexingServiceAppV1 {
  apiKind: "indexing-service/v1";

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

  imageName?: pulumi.Input<string>;
  indexName?: string;
  resources?: pulumi.Input<{
    consumer?: pulumi.Input<ComputeResources>;
    server?: pulumi.Input<ComputeResources>;
  }>;
  /*
  Default "live"
   */
  mode?: IndexingServiceMode;
}

export interface TimeRange {
  from?: number;
  to?: number;
}

function parseTimeRange(s: TimeRange | string): TimeRange {
  if (typeof s != "string") {
    return s
  }
  const [from, to] = s.split("-")
  return {
    from: from.length > 0 ? parseInt(from) : undefined,
    to: to.length > 0 ? parseInt(to) : undefined,
  }
}

export interface IndexingServiceAppV2 {
  apiKind: "indexing-service/v2";

  shardName: string;
  imageName?: pulumi.Input<string>;
  indexName?: string;

  streams: Record<string, {
    id: string;
    metadata?: {
      networks?: string[];
    }
  }[]>
  // String examples: "1662495440-1562495440", "1662495440-", "-1562495440"
  timeRange?: TimeRange | string;

  db: {
    name?: string;
    endpoint:
      | { type: "cloud" }
      | ({ type: "provision" } & {
      storage: pulumi.Input<MongoDbStorage>;
      resources?: pulumi.Input<ComputeResources>;
    });
  };
  resources?: pulumi.Input<{
    consumer?: pulumi.Input<ComputeResources>;
    server?: pulumi.Input<ComputeResources>;
  }>;
  // Default "live"
  mode?: IndexingServiceMode;
  // {filePath: content};
  configFiles?: ConfigFile[];
}

export type IndexingServiceMode =
  | "live"
  | "server-only"
  | "consumer-only"
  | "fast-sync";

export interface DeployedIndexingService {
  name: pulumi.Output<string>;
  networks: pulumi.Output<string[]>;
  internalEndpoint: pulumi.Output<string> | undefined;
  endpoint: pulumi.Output<string>;
}
