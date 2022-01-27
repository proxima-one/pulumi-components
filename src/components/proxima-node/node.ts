import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as dockerRegistry from "../dockerRegistry";
import * as kafka from "../kafka";
import * as minio from "../minio";
import * as namespaces from "../namespaces";
import * as mongodb from "../mongodb";
import * as proximaConfig from "@proxima-one/proxima-config";
import { mapLookup, ReadonlyLookup } from "../generics";
import * as yaml from "js-yaml";

export class ProximaNode extends pulumi.ComponentResource {
  public readonly proximaNamespaces: Record<string, pulumi.Output<string>>;
  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly namespaces: Record<
    "operators" | "services",
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
  public readonly configSecret: k8s.core.v1.Secret;

  public constructor(
    name: string,
    args: ProximaNodeArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:ProximaNode", name, args, opts);

    this.publicHost = args.publicHost;
    const ns = new namespaces.Namespaces(
      "namespaces",
      {
        namespaces: {
          operators: "operators",
          services: "services",
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
          namespaces: ns,
          registries: args.dockerRegistries,
        },
        { parent: this }
      );
    }

    if (notEmpty(args.kafkaClusters)) {
      for (const [key, clusterArgs] of Object.entries(args.kafkaClusters)) {
        if (clusterArgs.type != "Provision") continue;

        const { type, ...kafkaClusterArgs } = clusterArgs;
        if (!this.kafkaOperator) {
          this.kafkaOperator = new kafka.KafkaOperator(
            "kafka-operator",
            {
              namespace: ns.operators,
              watchAnyNamespace: false,
              watchNamespaces: [ns.services],
            },
            { parent: this }
          );
        }
        this.kafkaClusters[key] = new kafka.KafkaCluster(
          key,
          {
            ...kafkaClusterArgs,
            namespace: ns.services,
          },
          { dependsOn: this.kafkaOperator, parent: this }
        );
      }
    }

    if (notEmpty(args.minioClusters)) {
      for (const [key, objectStorageArgs] of Object.entries(
        args.minioClusters
      )) {
        if (objectStorageArgs.type != "Provision") continue;

        const { type, ...minioClusterArgs } = objectStorageArgs;
        if (!this.minioOperator) {
          this.minioOperator = new minio.MinioOperator(
            "minio-operator",
            {
              namespace: ns.operators,
              console: {
                publicHost: `minio-operator.${args.publicHost}`,
                path: "/",
              },
            },
            { parent: this }
          );
        }
        this.minioClusters[key] = new minio.MinioTenant(
          key,
          {
            namespace: ns.services,
            api: {
              publicHost: `${name}.${args.publicHost}`,
            },
            console: {
              publicHost: `${name}-console.${args.publicHost}`,
            },
            ...minioClusterArgs,
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
            ...newMongoDbArgs,
            namespace: ns.services,
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
          "config.yml": this.config.apply((c) => yaml.dump(c, { indent: 2 })),
          "config.json": this.config.apply((c) => JSON.stringify(c, null, 2)),
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
    args: ProximaNodeArgs
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

    return pulumi
      .all([
        provisionedKafkaConnections,
        provisionedMinioConnections,
        provisionedMongoDbs,
      ])
      .apply(([kafka, minio, mongos]) =>
        generateConfig(args, kafka, minio, mongos)
      );
  }
}

export interface ProximaNodeArgs {
  publicHost: string;
  dockerRegistries?: Record<string, dockerRegistry.DockerRegistryInfo | string>;

  mongoDbs?: Record<string, MongoDbArgs>;
  kafkaClusters?: Record<string, KafkaClusterArgs>;
  minioClusters?: Record<string, MinioClusterArgs>;
  storages?: Record<string, StorageArgs>;

  blockIndexers?: Record<string, BlockIndexerArgs>;
  documentCollections?: Record<string, DocumentCollectionArgs>;
  networks?: Record<string, NetworkArgs>;

  //streamDbs?: Record<string, StreamDbArgs>;
}

export interface StreamDbArgs {
  storageSize: string;
}

export type MongoDbArgs = ProvisionNewMongoDbArgs | ImportMongoDbArgs;

export type ProvisionNewMongoDbArgs = Omit<
  mongodb.MongoDBArgs,
  "namespaces"
> & {
  type: "Provision";
};

export interface ImportMongoDbArgs {
  type: "Import";

  config: Omit<proximaConfig.MongoDbConfig, "type">;
}

export type NetworkArgs = ImportNetworkArgs;

export type ImportNetworkArgs = {
  type: "Import";
  config: proximaConfig.NetworkConfig;
};

export type BlockIndexerArgs = ImportBlockIndexerArgs;

export type ImportBlockIndexerArgs = {
  type: "Import";
  config: proximaConfig.BlockIndexerConfig;
};

export type DocumentCollectionArgs = ImportDocumentCollectionArgs;

export type ImportDocumentCollectionArgs = {
  type: "Import";
  config: proximaConfig.DocumentCollectionConfig;
};

export type KafkaClusterArgs =
  | ProvisionNewKafkaClusterArgs
  | ImportKafkaClusterArgs;

export type ProvisionNewKafkaClusterArgs = Omit<
  kafka.KafkaClusterArgs,
  "namespace"
> & {
  type: "Provision";
};
export type ImportKafkaClusterArgs = {
  type: "Import";
  config: proximaConfig.KafkaJsConfig;
};

export type StorageArgs = ProvisionNewMinioBucketArgs | ImportStorage;

export type MinioClusterArgs = ProvisionNewMinioClusterArgs;

export type ProvisionNewMinioClusterArgs = Omit<
  minio.MinioTenantArgs,
  "namespace"
> & {
  type: "Provision";
};

export type ProvisionNewMinioBucketArgs = {
  type: "ProvisionMinioBucket";
  minio: string;
  bucket: string;
};

export interface ImportStorage {
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

export function generateConfig(
  args: ProximaNodeArgs,
  kafkas: ReadonlyLookup<kafka.KafkaConnectionDetails>,
  minios: ReadonlyLookup<minio.MinioConnectionDetails>,
  mongos: ReadonlyLookup<mongodb.MongoDbConnectionDetails>
): proximaConfig.ProximaNodeConfig {
  return {
    blockIndexers: mapLookup(args.blockIndexers ?? {}, toBlockIndexerConfig),
    databases: {
      ...mapLookup(args.kafkaClusters ?? {}, toKafkaConfig),
      ...mapLookup(args.mongoDbs ?? {}, toMongoDbConfig),
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
}
