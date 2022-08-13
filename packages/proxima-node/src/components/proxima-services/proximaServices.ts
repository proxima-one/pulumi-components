import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as dockerRegistry from "../dockerRegistry";
import * as kafka from "../kafka";
import * as minio from "../minio";
import * as namespaces from "../namespaces";
import * as mongodb from "../mongodb";
import * as blockindexer from "../blockindexer";
import * as ethindexer from "../eth-indexer";
import * as nearindexer from "../near-indexer";
import * as streamdb from "../streamdb";
import * as monitoring from "../streams-monitoring";
import * as stateManager from "../state-manager";
import * as proximaConfig from "@proxima-one/proxima-config";
import { strict as assert } from "assert";
import { mapLookup, ReadonlyLookup } from "../generics";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as utils from "@proxima-one/proxima-utils";
import { NewStorageClaim, ResourceRequirements } from "../types";

export class ProximaServices<
  TNamespaces extends string
> extends pulumi.ComponentResource {
  public readonly proximaNamespaces: Record<string, pulumi.Output<string>>;
  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly namespaces: Record<
    "operators" | "services" | TNamespaces,
    k8s.core.v1.Namespace
  >;
  public readonly publicHost: string;
  public readonly config: pulumi.Output<proximaConfig.ProximaNodeConfig>;

  public readonly dockerRegistry?: dockerRegistry.DockerRegistry;
  public readonly kafkaOperator?: kafka.KafkaOperator;
  public readonly minioOperator?: minio.MinioOperator;

  public readonly kafkaClusters: Record<string, kafka.KafkaCluster> = {};
  public readonly minioClusters: Record<string, minio.MinioTenant> = {};
  public readonly mongoDbs: Record<string, mongodb.MongoDB> = {};
  public readonly blockIndexers: Record<string, blockindexer.BlockIndexer> = {};
  public readonly ethIndexers: Record<string, ethindexer.EthIndexer> = {};
  public readonly nearIndexers: Record<string, nearindexer.NearIndexer> = {};
  public readonly streamDBs: Record<string, streamdb.StreamDB> = {};
  public readonly streamsMonitoring: Record<
    string,
    monitoring.StreamsMonitoring
  > = {};
  public readonly stateManagers: Record<string, stateManager.StateManager> = {};
  public readonly configSecret: k8s.core.v1.Secret;

  public constructor(
    name: string,
    args: ProximaNodeArgs<TNamespaces>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:ProximaServices", name, args, opts);

    this.publicHost = args.publicHost;
    const ns = new namespaces.Namespaces(
      "namespaces",
      {
        namespaces: {
          operators: "operators",
          services: "services",
          ...args.namespaces,
        },
        autoName: false,
      },
      { parent: this }
    ).output;

    this.namespaces = ns;
    this.proximaNamespaces = {
      operators: ns.operators.metadata.name,
      services: ns.services.metadata.name,
    };

    if (notEmpty(args.dockerRegistries)) {
      this.dockerRegistry = new dockerRegistry.DockerRegistry(
        "docker-registry",
        {
          namespaces: pulumi.all(mapLookup(ns, (x) => x.metadata.name)),
          registries: args.dockerRegistries,
        },
        { parent: this }
      );
    }
    const servicesImagePullSecrets = this.dockerRegistry
      ? this.dockerRegistry.secrets.apply((secrets) =>
          secrets
            .filter((x) => x.namespaceKey == "services")
            .map((s) => s.secretName)
        )
      : [];

    if (notEmpty(args.kafkaClusters)) {
      for (const [key, clusterArgs] of Object.entries(args.kafkaClusters)) {
        if (clusterArgs.type != "Provision") continue;

        const { type, ...kafkaClusterArgs } = clusterArgs;
        if (!this.kafkaOperator && args.omitKafkaOperator !== true) {
          this.kafkaOperator = new kafka.KafkaOperator(
            "kafka-operator",
            {
              namespace: ns.operators.metadata.name,
              watchAnyNamespace: false,
              watchNamespaces: pulumi.all([ns.services.metadata.name]),
              nodeSelector: args.nodeSelector,
            },
            { parent: this }
          );
        }
        this.kafkaClusters[key] = new kafka.KafkaCluster(
          key,
          {
            ...kafkaClusterArgs,
            namespace: ns.services.metadata.name,
          },
          { dependsOn: this.kafkaOperator, parent: this }
        );
      }
    }

    if (notEmpty(args.minioClusters)) {
      for (const [minioName, objectStorageArgs] of Object.entries(
        args.minioClusters
      )) {
        if (objectStorageArgs.type != "Provision") continue;

        const { type, ...minioClusterArgs } = objectStorageArgs;
        if (!this.minioOperator && args.omitMinioOperator !== true) {
          this.minioOperator = new minio.MinioOperator(
            "minio-operator",
            {
              namespace: ns.operators.metadata.name,
              nodeSelector: args.nodeSelector,
              console: {
                publicHost: `minio-operator.${args.publicHost}`,
                path: "/",
              },
            },
            { parent: this }
          );
        }
        this.minioClusters[minioName] = new minio.MinioTenant(
          minioName,
          {
            api: {
              publicHost: `minio-${minioName}.${args.publicHost}`,
            },
            console: {
              publicHost: `minio-${minioName}-console.${args.publicHost}`,
            },
            nodeSelector: args.nodeSelector,
            ...minioClusterArgs,
            namespace: ns.services.metadata.name,
          },
          { dependsOn: this.minioOperator, parent: this }
        );
      }
    }

    if (notEmpty(args.mongoDbs)) {
      for (const [key, mongoDbArgs] of Object.entries(args.mongoDbs)) {
        if (mongoDbArgs.type != "Provision") continue;

        const { type, ...newMongoDbArgs } = mongoDbArgs;
        this.mongoDbs[key] = new mongodb.MongoDB(
          key,
          {
            nodeSelector: args.nodeSelector,
            ...newMongoDbArgs,
            namespace: ns.services.metadata.name,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.blockIndexers)) {
      for (const [key, blockIndexerArgs] of Object.entries(
        args.blockIndexers
      )) {
        if (blockIndexerArgs.type != "Provision") continue;

        const { type, ...newBlockIndexerArgs } = blockIndexerArgs;
        const mongodb = this.mongoDbs[newBlockIndexerArgs.storage.mongodb];
        this.blockIndexers[key] = new blockindexer.BlockIndexer(
          `blockindexer-${key}`,
          {
            namespace: ns.services.metadata.name,
            publicHost: newBlockIndexerArgs.publicHost,
            resources: newBlockIndexerArgs.resources,
            imagePullSecrets: servicesImagePullSecrets,
            storage: mongodb.connectionDetails.apply((x) => {
              return {
                type: "MongoDB",
                uri: x.endpoint,
                database: x.database,
              };
            }),
            auth: {
              password: {
                type: "random",
                name: `${key}-authToken`,
              },
            },
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.ethIndexers)) {
      for (const [key, ethIndexerArgs] of Object.entries(args.ethIndexers)) {
        if (ethIndexerArgs.type != "Provision") continue;

        const mongodb = this.mongoDbs[ethIndexerArgs.storage.mongodb];
        this.ethIndexers[key] = new ethindexer.EthIndexer(
          `ethindexer-${key}`,
          {
            namespace: ns.services.metadata.name,
            publicHost: ethIndexerArgs.publicHost,
            resources: ethIndexerArgs.resources,
            imagePullSecrets: servicesImagePullSecrets,
            connection: ethIndexerArgs.connection,
            storage: mongodb.connectionDetails.apply((x) => {
              return {
                type: "MongoDB",
                uri: x.endpoint,
                database: x.database,
                compress: "zlib",
              };
            }),
            auth: {
              password: {
                type: "random",
                name: `${key}-authToken`,
              },
            },
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.nearIndexers)) {
      for (const [key, nearIndexerArgs] of Object.entries(args.nearIndexers)) {
        if (nearIndexerArgs.type != "Provision") continue;

        const mongodb = this.mongoDbs[nearIndexerArgs.storage.mongodb];
        this.nearIndexers[key] = new nearindexer.NearIndexer(
          `nearindexer-${key}`,
          {
            namespace: ns.services.metadata.name,
            publicHost: nearIndexerArgs.publicHost,
            resources: nearIndexerArgs.resources,
            imagePullSecrets: servicesImagePullSecrets,
            connection: nearIndexerArgs.connection,
            network: nearIndexerArgs.network,
            storage: mongodb.connectionDetails.apply((x) => {
              return {
                type: "MongoDB",
                uri: x.endpoint,
                database: x.database,
              };
            }),
            auth: {
              password: {
                type: "random",
                name: `${key}-authToken`,
              },
            },
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.streamDBs)) {
      for (const [key, streamDBArgs] of Object.entries(args.streamDBs)) {
        if (streamDBArgs.type != "Provision") continue;

        const { type, ...newStreamDBArgs } = streamDBArgs;
        const mongodb = this.mongoDbs[newStreamDBArgs.storage.mongodb];
        this.streamDBs[key] = new streamdb.StreamDB(
          `streamdb-${key}`,
          {
            namespace: ns.services.metadata.name,
            publicHost: newStreamDBArgs.publicHost,
            resources: newStreamDBArgs.resources,
            imagePullSecrets: servicesImagePullSecrets,
            storage: mongodb.connectionDetails.apply((x) => {
              return {
                connectionString: x.endpoint,
                db: x.database,
                streams: [],
              };
            }),
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.streamsMonitoring)) {
      for (const [key, monitoringArgs] of Object.entries(
        args.streamsMonitoring
      )) {
        if (monitoringArgs.type != "Provision") continue;

        const mongodb = this.mongoDbs[monitoringArgs.storage.mongodb];
        this.streamsMonitoring[key] = new monitoring.StreamsMonitoring(
          `streams-monitoring-${key}`,
          {
            namespace: ns.services.metadata.name,
            resources: monitoringArgs.resources,
            imagePullSecrets: servicesImagePullSecrets,
            storage: mongodb.connectionDetails.apply((x) => {
              return {
                uri: x.endpoint,
                database: x.database,
              };
            }),
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    if (notEmpty(args.stateManagers)) {
      for (const [key, stateManagerArgs] of Object.entries(
        args.stateManagers
      )) {
        if (stateManagerArgs.type != "Provision") continue;

        const { type, ...newStateManager } = stateManagerArgs;
        this.stateManagers[key] = new stateManager.StateManager(
          `state-manager-${key}`,
          {
            namespace: ns.services.metadata.name,
            imageName: newStateManager.imageName,
            imagePullSecrets: servicesImagePullSecrets,
            publicHost: newStateManager.publicHost,
            resources: newStateManager.resources,
            storage: newStateManager.storage,
            nodeSelector: args.nodeSelector,
          },
          { parent: this }
        );
      }
    }

    this.resolvedPasswords = pulumi
      .all([
        ...Object.values(this.mongoDbs).map((x) => x.resolvedPasswords),
        ...Object.values(this.minioClusters).map((x) => x.resolvedPasswords),
      ])
      .apply(merge);

    // generate config. TODO: add other services
    this.config = this.generateConfig(args);

    this.configSecret = new k8s.core.v1.Secret(
      "proxima-config",
      {
        metadata: {
          namespace: ns.services.metadata.name,
        },
        data: {
          "config.yml": this.config.apply((c) =>
            Buffer.from(yaml.dump(c, { indent: 2 })).toString("base64")
          ),
          "config.json": this.config.apply((c) =>
            Buffer.from(JSON.stringify(c, null, 2)).toString("base64")
          ),
        },
      },
      { parent: this }
    );

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
      proximaNamespaces: this.proximaNamespaces,
      config: this.config,
    });
  }

  private generateConfig(
    args: ProximaNodeArgs<TNamespaces>
  ): pulumi.Output<proximaConfig.ProximaNodeConfig> {
    const provisionedKafkaConnections = pulumi.all(
      mapLookup(this.kafkaClusters, (x) => x.connectionDetails)
    );

    const provisionedMinioConnections = pulumi.all(
      mapLookup(this.minioClusters, (x) => x.connectionDetails)
    );

    const provisionedMongoDbs = pulumi.all(
      mapLookup(this.mongoDbs, (x) => x.connectionDetails)
    );

    const blockIndexers = pulumi.all(
      mapLookup(this.blockIndexers, (x) => x.connectionDetails)
    );

    const stateManagerConnections = pulumi.all(
      mapLookup(this.stateManagers, (x) => x.connectionDetails)
    );

    return pulumi
      .all([
        provisionedKafkaConnections,
        provisionedMinioConnections,
        provisionedMongoDbs,
        blockIndexers,
        stateManagerConnections,
      ])
      .apply(([kafka, minio, mongos, blockIndexers, stateManagers]) =>
        generateConfig(args, kafka, minio, mongos, blockIndexers, stateManagers)
      );
  }
}

export interface ProximaNodeArgs<TNamespaces extends string> {
  publicHost: string;
  namespaces: Record<TNamespaces, string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  dockerRegistries?: Record<string, dockerRegistry.DockerRegistryInfo | string>;

  mongoDbs?: Record<string, MongoDbArgs>;
  kafkaClusters?: Record<string, KafkaClusterArgs>;
  minioClusters?: Record<string, MinioClusterArgs>;
  storages?: Record<string, StorageArgs>;

  blockIndexers?: Record<string, BlockIndexerArgs>;
  ethIndexers?: Record<string, EthIndexerArgs>;
  nearIndexers?: Record<string, NearIndexerArgs>;
  streamDBs?: Record<string, StreamDBArgs>;
  streamsMonitoring?: Record<string, StreamsMonitoringArgs>;
  stateManagers?: Record<string, StateManagerArgs>;
  documentCollections?: Record<string, DocumentCollectionArgs>;
  networks?: Record<string, NetworkArgs>;

  omitMinioOperator?: boolean;
  omitKafkaOperator?: boolean;

  //streamDbs?: Record<string, StreamDbArgs>;
}

// interface StreamDbArgs {
//   storageSize: string;
// }

type MongoDbArgs = ProvisionNewMongoDbArgs | ImportMongoDbArgs;

type ProvisionNewMongoDbArgs = Omit<mongodb.MongoDBArgs, "namespaces"> & {
  type: "Provision";
};

interface ImportMongoDbArgs {
  type: "Import";

  config: Omit<proximaConfig.MongoDbConfig, "type">;
}

type NetworkArgs = ImportNetworkArgs;

type ImportNetworkArgs = {
  type: "Import";
  config: proximaConfig.NetworkConfig;
};

type StreamDBArgs = ProvisionStreamDBArgs;
type ProvisionStreamDBArgs = {
  type: "Provision";
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
  storage: {
    mongodb: string;
  };
};

type StateManagerArgs = ProvisionStateManagerArgs;
type ProvisionStateManagerArgs = {
  type: "Provision";
  imageName: pulumi.Input<string>;
  resources?: ResourceRequirements;
  storage: NewStorageClaim;
  publicHost?: pulumi.Input<string | string[]>;
};

type EthIndexerArgs = ProvisionEthIndexerArgs;

interface ProvisionEthIndexerArgs {
  type: "Provision";
  connection: {
    http?: pulumi.Input<string>;
    wss?: pulumi.Input<string>;
  };
  storage: {
    mongodb: string;
  };
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
}

type NearIndexerArgs = ProvisionNearIndexerArgs;
interface ProvisionNearIndexerArgs {
  type: "Provision";
  connection: {
    http: pulumi.Input<string>;
  };
  network: string;
  storage: {
    mongodb: string;
  };
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
}

type StreamsMonitoringArgs = ProvisionStreamsMonitoringArgs;
interface ProvisionStreamsMonitoringArgs {
  type: "Provision";
  storage: {
    mongodb: string;
  };
  resources?: ResourceRequirements;
}

type BlockIndexerArgs = ImportBlockIndexerArgs | ProvisionBlockIndexerArgs;

type ImportBlockIndexerArgs = {
  type: "Import";
  config: proximaConfig.BlockIndexerConfig;
};

type ProvisionBlockIndexerArgs = {
  type: "Provision";
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
  storage: {
    mongodb: string;
  };
};

type DocumentCollectionArgs = ImportDocumentCollectionArgs;

type ImportDocumentCollectionArgs = {
  type: "Import";
  config: proximaConfig.DocumentCollectionConfig;
};

type KafkaClusterArgs = ProvisionNewKafkaClusterArgs | ImportKafkaClusterArgs;

type ProvisionNewKafkaClusterArgs = Omit<
  kafka.KafkaClusterArgs,
  "namespace"
> & {
  type: "Provision";
};
type ImportKafkaClusterArgs = {
  type: "Import";
  config: proximaConfig.KafkaJsConfig;
};

type StorageArgs = ProvisionNewMinioBucketArgs | ImportStorage;

type MinioClusterArgs = ProvisionNewMinioClusterArgs;

type ProvisionNewMinioClusterArgs = Omit<minio.MinioTenantArgs, "namespace"> & {
  type: "Provision";
};

type ProvisionNewMinioBucketArgs = {
  type: "ProvisionMinioBucket";
  minio: string;
  bucket: string;
};

interface ImportStorage {
  type: "Import";

  config: proximaConfig.StorageConfig;
}

function notEmpty<T>(
  lookup: Record<string, T> | undefined
): lookup is Record<string, T> {
  return lookup != undefined && Object.keys(lookup).length > 0;
}

function merge<T>(lookups: Record<string, T>[]): Record<string, T> {
  const result: Record<string, T> = {};

  for (const lookup of lookups)
    for (const [key, value] of Object.entries(lookup)) {
      if (result[key])
        throw new Error(`Can't merge objects: duplicate key ${key}`);

      result[key] = value;
    }

  return result;
}

function generateConfig<TNamespaces extends string>(
  args: ProximaNodeArgs<TNamespaces>,
  kafkas: ReadonlyLookup<kafka.KafkaConnectionDetails>,
  minios: ReadonlyLookup<minio.MinioConnectionDetails>,
  mongos: ReadonlyLookup<mongodb.MongoDbConnectionDetails>,
  blockIndexers: ReadonlyLookup<blockindexer.BlockIndexerConnectionDetails>,
  stateManagers: ReadonlyLookup<stateManager.StateManagerConnectionDetails>
): proximaConfig.ProximaNodeConfig {
  return {
    blockIndexers: mapLookup(args.blockIndexers ?? {}, toBlockIndexerConfig),
    databases: {
      ...mapLookup(args.kafkaClusters ?? {}, toKafkaConfig),
      ...mapLookup(args.mongoDbs ?? {}, toMongoDbConfig),
      ..._.mapKeys(
        mapLookup(args.stateManagers ?? {}, toStateManagerConfig),
        (_value, key) => `state-manager-${key}`
      ),
    },
    documentCollections: mapLookup(
      args.documentCollections ?? {},
      toDocumentCollectionConfig
    ),
    networks: mapLookup(args.networks ?? {}, toNetworkConfig),
    storages: mapLookup(args.storages ?? {}, toStorageConfig),
  };

  function toBlockIndexerConfig(
    args: BlockIndexerArgs,
    key: string
  ): proximaConfig.BlockIndexerConfig {
    switch (args.type) {
      case "Import":
        return args.config;
      case "Provision": {
        const connectionDetails = blockIndexers[key];
        return {
          type: "grpc",
          uri: connectionDetails.endpoint,
          authToken: connectionDetails.authToken,
        };
      }
      default:
        throw new Error("not implemented");
    }
  }

  function toDocumentCollectionConfig(
    args: DocumentCollectionArgs,
    key: string
  ): proximaConfig.DocumentCollectionConfig {
    switch (args.type) {
      case "Import":
        return args.config;
      default:
        throw new Error("not implemented");
    }
  }

  function toNetworkConfig(
    args: NetworkArgs,
    key: string
  ): proximaConfig.NetworkConfig {
    switch (args.type) {
      case "Import":
        return args.config;
      default:
        throw new Error("not implemented");
    }
  }

  function toStorageConfig(
    args: StorageArgs,
    key: string
  ): proximaConfig.StorageConfig {
    switch (args.type) {
      case "Import":
        return args.config;
      case "ProvisionMinioBucket":
        const connectionDetails = minios[args.minio];
        return {
          type: "s3",
          endpoint: connectionDetails.endpoint,
          bucket: args.bucket,
          accessKeyId: connectionDetails.accessKey,
          secretAccessKey: connectionDetails.secretKey,
        };
    }
  }

  function toKafkaConfig(
    args: KafkaClusterArgs,
    key: string
  ): proximaConfig.DatabaseConfig {
    switch (args.type) {
      case "Import":
        return {
          ...args.config,
          type: "kafka",
        };
      case "Provision":
        const connectionDetails = kafkas[key];
        return {
          type: "kafka",
          clientId: "proxima.cluster.local",
          brokers: connectionDetails.brokers,
          ssl: connectionDetails.ssl,
          replicationFactor: connectionDetails.replicationFactor,
        };
    }
  }

  function toMongoDbConfig(
    args: MongoDbArgs,
    key: string
  ): proximaConfig.DatabaseConfig {
    switch (args.type) {
      case "Import":
        return {
          ...args.config,
          type: "mongodb",
        };
      case "Provision":
        const connectionDetails = mongos[key];
        return {
          type: "mongodb",
          uri: connectionDetails.endpoint,
          db: connectionDetails.database,
        };
    }
  }

  function toStateManagerConfig(
    args: StateManagerArgs,
    key: string
  ): proximaConfig.DatabaseConfig {
    switch (args.type) {
      case "Provision":
        const connectionDetails = stateManagers[key];
        return {
          type: "state-manager",
          uri: connectionDetails.endpoint,
        };
    }
  }
}
