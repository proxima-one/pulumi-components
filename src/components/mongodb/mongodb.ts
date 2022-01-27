import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";

import { PersistenceConfiguration, ValuesSchema } from "./values";
import {
  ExistingStorageClaim,
  NewStorageClaim,
  Password,
  Resources,
} from "../types";

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class MongoDB extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create MongoDB instance
   */
  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;

  public readonly connectionDetails: pulumi.Output<MongoDbConnectionDetails>;

  public constructor(
    name: string,
    args: MongoDBArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MongoDB", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);
    const auth: MongoDBAuth = args.auth ?? {
      user: "root",
      database: name,
      password: {
        type: "random",
        name: `${name}-secret`,
      },
    };

    const persistence: PersistenceConfiguration = { enabled: true };
    if (args.storage.type == "new") {
      persistence.size = args.storage.size;
      persistence.storageClass = args.storage.class;
    } else {
      persistence.existingClaim = args.storage.name;
    }

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: "https://charts.bitnami.com/bitnami",
        },
        chart: "mongodb",
        version: "10.31.1",
        namespace: args.namespace.metadata.name,
        values: {
          auth: passwords.resolve(auth.password).apply((pass) => {
            return {
              enabled: true,
              usernames: [auth.user],
              databases: [auth.database],
              passwords: [pass],
            };
          }),
          persistence: persistence,
          replicaCount: 1,
          resources: args.resources ?? {
            requests: {
              cpu: "100m",
              memory: "200Mi",
            },
            limits: {
              cpu: "1000m",
              memory: "1Gi",
            },
          },
        },
      },
      { parent: this }
    );

    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.connectionDetails = pulumi
      .all([args.namespace.metadata.name, passwords.resolve(auth.password)])
      .apply(([ns, pass]) => {
        return {
          database: auth.database,
          endpoint: `mongodb://${auth.user}:${pass}@${ns}.svc.cluster.local`,
        };
      });

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
      connectionDetails: this.connectionDetails,
    });
  }
}

export interface MongoDBArgs {
  namespace: k8s.core.v1.Namespace;
  resources?: Resources;

  auth?: MongoDBAuth;
  storage: Storage;
}

export interface MongoDBAuth {
  user: string;
  database: string;
  password: Password;
}

export type Storage =
  | (NewStorageClaim & { type: "new" })
  | (ExistingStorageClaim & { type: "existing" });

export interface MongoDbConnectionDetails {
  endpoint: string;
  database: string;
}
