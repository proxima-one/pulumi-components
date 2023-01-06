import * as pulumi from "@pulumi/pulumi";
import { AppDeployerBase, DeployParams } from "./base";
import * as k8sServices from "@proxima-one/pulumi-proxima-node";
import {MongoDbStorage, PvcRequest, ServicePort} from "@proxima-one/pulumi-proxima-node";
import * as yaml from "js-yaml";
import {ComputeResources, Storage} from "@proxima-one/pulumi-k8s-base";
import { strict as assert } from "assert";

export class IndexingServiceDeployer extends AppDeployerBase {
  private webService: k8sServices.WebServiceDeployer;
  private mongo: k8sServices.MongoDeployer;

  public constructor(params: DeployParams) {
    super(params);

    this.webService = new k8sServices.WebServiceDeployer(
      this.getDeployParams("indexing")
    );
    this.mongo = new k8sServices.MongoDeployer(
      this.getDeployParams("indexing-storage")
    );
  }

  public deploy(app: IndexingServiceApp): DeployedIndexingService {
    switch (app.apiKind) {
      case "indexing-service/v2": {
        const name = app.name ?? this.project;
        const indexName = app.indexName ?? this.project;
        const dbName = app.db.name ?? "proxima";
        const mode = app.mode ?? "live";
        const streamDbUrl = app.streamDbUrl ?? "streams.proxima.one:443";
        const consumerAddr = streamDbUrl.split(":")[0];
        const consumerPort = streamDbUrl.split(":")[1] ?? "443";

        const db = app.db.endpoint;
        let mongoUri: pulumi.Input<string>;

        if (db.type == "provision") {
          const mongo = this.mongo.deploy({
            storage: pulumi.output(db.storage).apply((x) => {
              if (x.type == "new")
                return { type: "provision", size: x.size, class: x.class };
              return x.name;
            }),
            name: `${name}-db`,
            webUI: db.webUI,
            resources: db.resources,
            replicaSet: db.replicaSet,
            publicHost: pulumi.interpolate`${name}-db.${this.publicHost}`,
            version: "4.4",
            auth: {
              user: "proxima",
              password: { type: "random", name: `${name}-db` },
              database: dbName,
            },
          });

          mongoUri = mongo.connectionDetails.endpoint;
        } else {
          mongoUri = this.requireService<{ endpoint: string }>(
            db.name,
            "mongodb"
          ).endpoint;
        }

        const env = pulumi.all({
          MODE: app.mode ?? "live",
          METRICS_PORT: "2112",
          STATUS_GRPC_PORT: "26000",
          STATUS_HTTP_PORT: "9090",
        });

        const consumerEnv: Record<string, string> = {
          CONSUME_HOST: consumerAddr,
          CONSUME_PORT: consumerPort,
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

        const configs: k8sServices.ConfigFile[] = [
          {
            path: "/app/config/config.yaml",
            content: mongoUri.apply((uri) =>
              yaml.dump({
                streams: app.streams,
                timeRange: app.timeRange
                  ? TimeRangeToIso8601(app.timeRange)
                  : undefined,
                target: {
                  dbUri: uri,
                  dbName: dbName,
                },
                shard: {
                  name: app.shardName,
                },
              })
            ),
          },
        ];
        if (app.configFiles) {
          configs.push(...app.configFiles);
        }

        const resources = pulumi.output(app.resources);
        const deployedWebService = this.webService.deploy({
          name: name,
          imageName: app.imageName,
          configFiles: configs,
          publicHost: this.publicHost,
          parts: {
            consumer: {
              disabled: mode == "server-only",
              env: env.apply((x) => ({ ...x, ...consumerEnv })),
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
                {
                  name: "http-status",
                  containerPort: 9090,
                },
                {
                  name: "grpc-status",
                  containerPort: 26000,
                },
              ],
              pvcs: app.pvcs,
            },
            server: {
              disabled: mode == "consumer-only" || mode == "fast-sync",
              env: env.apply((x) => ({ ...x, ...serverEnv })),
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
                  name: "http-status",
                  containerPort: 9090,
                },
                {
                  name: "grpc-status",
                  containerPort: 26000,
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
              pvcs: app.pvcs,
            },
          },
        });

        const deployedServer = deployedWebService.parts["server"];
        const internalHost = deployedServer
          ? deployedServer.internalHost
          : undefined;
        return {
          name: pulumi.output(name),
          networks: pulumi.output([
            ...new Set<string>( // unique networks from all streams
              Object.entries(app.streams).reduce<string[]>((acc, cur) => {
                return acc.concat(
                  cur[1].reduce<string[]>((acc, cur) => {
                    return cur.metadata?.networks
                      ? acc.concat(cur.metadata?.networks)
                      : acc;
                  }, [])
                );
              }, [])
            ),
          ]),
          endpoint: this.publicHost.apply((x) => `${name}.${x}:443`),
          restEndpoint: this.publicHost.apply((x) => `${name}-rest.${x}`),
          mode: pulumi.output(app.mode ?? "live"),
          shardName: pulumi.output(app.shardName),
          timeRange: pulumi.output({
            from: app.timeRange?.from?.toISOString(),
            to: app.timeRange?.to?.toISOString(),
          } as DeployedServiceTimeRange),
          internalEndpoint: internalHost ? internalHost.apply((host) => `${host}:27000`) : undefined,
          internalRestEndpoint: internalHost ? internalHost.apply((host) => `${host}:8080`) : undefined,
          dbType: pulumi.output(app.db.endpoint.type),
        };
      }

      case "indexing-service/v3": {
        const name = `${app.indexName}-${app.shardName}`;
        const mode = app.mode ?? "live";
        const streamRegistryUrl = app.streamRegistryUrl ?? "https://streams.api.proxima.one";

        let target: pulumi.Output<any> = pulumi.output({db: "none"});
        let pvc: pulumi.Input<k8sServices.PvcRequest> | undefined = undefined;
        if (app.db) {
          switch (app.db.type) {
            case "mongo-provision": {
              const mongo = this.mongo.deploy({
                storage: pulumi.output(app.db.storage).apply((x) => {
                  if (x.type == "new")
                    return {type: "provision", size: x.size, class: x.class};
                  return x.name;
                }),
                name: `${name}-db`,
                webUI: app.db.webUI,
                resources: app.db.resources,
                replicaSet: app.db.replicaSet,
                publicHost: pulumi.interpolate`${name}-db.${this.publicHost}`,
                version: "4.4",
                auth: {
                  user: "proxima",
                  password: {type: "random", name: `${name}-db`},
                  database: "proxima",
                },
              });
              target = mongo.connectionDetails.endpoint.apply(endpoint => ({
                dbUri: endpoint,
                dbName: "proxima",
              }));
              break
            }

            case "mongo-import": {
              const dbName = app.db.dbName;
              target = this.requireService<{ endpoint: string }>(app.db.serviceName, "mongodb").endpoint.apply(
                endpoint => ({
                  dbUri: endpoint,
                  dbName: dbName,
                })
              );
              break
            }

            case "pvc": {
              pvc = pulumi.output(app.db.storage).apply(storage => ({
                name: "app-data",
                path: "/app/data",
                storage: storage,
              }));
              target = pulumi.output({
                dataPath: "/app/data"
              })
              break
            }
          }
        }

        const metricsLabels = {
          env: this.env,
          index: app.indexName,
          shard: app.shardName,
        };

        const configs: k8sServices.ConfigFile[] = [{
          path: "/app/config/config.yaml",
          content: target.apply(appTarget =>
            yaml.dump({
              streams: app.streams,
              timeRange: app.timeRange ? TimeRangeToIso8601(app.timeRange) : undefined,
              target: appTarget,
              overrideStreamDbUrl: app.overrideStreamDbUrl,
              streamRegistryUrl: streamRegistryUrl,
              mode: indexingServiceModeToConfigMode(mode),
              shard: {
                name: app.shardName,
              },
            })
          ),
        }];
        if (app.configFiles) {
          configs.push(...app.configFiles);
        }

        const commonPorts: ServicePort[] = [
          {
            name: "http-metrics",
            containerPort: 2112,
          },
        ];
        const consumerPorts: ServicePort[] = [];
        const serverPorts: ServicePort[] = [
          {
            name: "http-status",
            containerPort: 9090,
          },
          {
            name: "grpc-status",
            containerPort: 26000,
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
        ];
        const resources = pulumi.output(app.resources);

        const consumer = {
          disabled: mode == "server-only",
          args: ["./consumer"],
          resources: resources.apply(x => x?.consumer),
          metrics: {
            labels: metricsLabels,
          },
          ports: consumerPorts.concat(commonPorts).concat(app.type == "single-pod" ? serverPorts : []),
          pvcs: pvc ? [pvc] : [],
        };
        let server: any = {disabled: true};
        if (app.type == "consumer-server") {
          assert(app.db?.type != "pvc");
          server = {
            disabled: mode == "consumer-only" || mode == "fast-sync",
            args: ["./server"],
            resources: resources.apply((x) => x?.server),
            metrics: {
              labels: metricsLabels,
            },
            ports: serverPorts.concat(commonPorts),
            pvcs: pvc ? [pvc] : [],
          };
        }

        const deployedWebService = this.webService.deploy({
          name: name,
          imageName: app.imageName,
          configFiles: configs,
          publicHost: this.publicHost,
          parts: {
            consumer: consumer,
            server: server,
          },
        });

        const deployedServer = deployedWebService.parts["server"];
        const internalHost = deployedServer
          ? deployedServer.internalHost
          : undefined;
        return {
          name: pulumi.output(name),
          networks: pulumi.output([
            ...new Set<string>( // unique networks from all streams
              Object.entries(app.streams).reduce<string[]>((acc, cur) => {
                return acc.concat(
                  cur[1].reduce<string[]>((acc, cur) => {
                    return cur.metadata?.networks
                      ? acc.concat(cur.metadata?.networks)
                      : acc;
                  }, [])
                );
              }, [])
            ),
          ]),
          endpoint: this.publicHost.apply((x) => `${name}.${x}:443`),
          restEndpoint: this.publicHost.apply((x) => `${name}-rest.${x}`),
          mode: pulumi.output(app.mode ?? "live"),
          shardName: pulumi.output(app.shardName),
          timeRange: pulumi.output({
            from: app.timeRange?.from?.toISOString(),
            to: app.timeRange?.to?.toISOString(),
          } as DeployedServiceTimeRange),
          internalEndpoint: internalHost ? internalHost.apply((host) => `${host}:27000`) : undefined,
          internalRestEndpoint: internalHost ? internalHost.apply((host) => `${host}:8080`) : undefined,
          dbType: pulumi.output(app.db?.type ?? "none"),
        };
      }
    }
  }
}

export type IndexingServiceApp = (IndexingServiceAppV2 & { name?: string }) | IndexingServiceAppV3;

export interface IndexingServiceDb {
  name?: string;
  endpoint:
    | { type: "import"; name: string }
    | ({ type: "provision" } & {
    storage: pulumi.Input<MongoDbStorage>;
    replicaSet?: number;
    webUI?: boolean;
    resources?: pulumi.Input<ComputeResources>;
  });
}

function TimeRangeToIso8601(range: TimeRange): {
  from?: string;
  to?: string;
} {
  return {
    from: range.from?.toISOString(),
    to: range.to?.toISOString(),
  };
}

export interface TimeRange {
  from?: Date;
  to?: Date;
}

export interface IndexingServiceAppV2 {
  apiKind: "indexing-service/v2";

  shardName: string;
  imageName?: pulumi.Input<string>;
  indexName?: string;

  streamDbUrl?: string;
  streams: Record<
    string,
    {
      id: string;
      metadata?: {
        networks?: string[];
      };
    }[]
  >;
  timeRange?: TimeRange;

  db: IndexingServiceDb;
  resources?: pulumi.Input<{
    consumer?: pulumi.Input<ComputeResources>;
    server?: pulumi.Input<ComputeResources>;
  }>;
  // Default "live"
  mode?: IndexingServiceMode;
  // {filePath: content};
  configFiles?: k8sServices.ConfigFile[];
  pvcs?: pulumi.Input<pulumi.Input<PvcRequest>[]>;
}

export type IndexingServiceV3Db = {
  type: "mongo-import";
  serviceName: string;
  dbName: string;
} | {
  type: "mongo-provision";
  storage: pulumi.Input<MongoDbStorage>;
  replicaSet?: number;
  webUI?: boolean;
  resources?: pulumi.Input<ComputeResources>;
} | {
  type: "pvc";
  storage: pulumi.Input<Storage>;
}

export interface IndexingServiceAppV3 {
  apiKind: "indexing-service/v3";

  indexName: string;
  shardName: string;
  type: "consumer-server" | "single-pod";
  imageName?: pulumi.Input<string>;
  streamRegistryUrl?: string;
  overrideStreamDbUrl?: string;
  timeRange?: TimeRange;
  streams: Record<string, { id: string; metadata?: { networks?: string[] } }[]>;
  db?: IndexingServiceV3Db;
  resources?: pulumi.Input<{
    // consumer resources are used in single-pod mode
    consumer?: pulumi.Input<ComputeResources>;
    server?: pulumi.Input<ComputeResources>;
  }>;

  // Default "live"
  mode?: IndexingServiceMode;

  // {filePath: content};
  configFiles?: k8sServices.ConfigFile[];
}

function indexingServiceModeToConfigMode(mode: IndexingServiceMode): "fast-sync" | "live" {
  switch (mode) {
    case "live":
    case "server-only":
      return "live"
    case "fast-sync":
    case "consumer-only":
      return "fast-sync"
  }
}

export type IndexingServiceMode =
  | "live"
  | "server-only"
  | "consumer-only"
  | "fast-sync";

export interface DeployedServiceTimeRange {
  from?: string;
  to?: string;
}

export interface DeployedIndexingService {
  name: pulumi.Output<string>;
  networks: pulumi.Output<string[]>;
  internalEndpoint: pulumi.Output<string> | undefined;
  internalRestEndpoint: pulumi.Output<string> | undefined;
  shardName: pulumi.Output<string> | undefined;
  mode: pulumi.Output<string>;
  dbType: pulumi.Output<string>;
  restEndpoint: pulumi.Output<string>;
  endpoint: pulumi.Output<string>;
  timeRange: pulumi.Output<DeployedServiceTimeRange>;
}
