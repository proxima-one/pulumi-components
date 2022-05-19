import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";

import { PersistenceConfiguration } from "./values";
import {
  ExistingStorageClaim,
  NewStorageClaim,
  Password,
  ResourceRequirements,
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

    //    const metricsPassword = passwords.resolve({type: "random", name: `${name}-metrics-pass`});

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
        namespace: args.namespace,
        values: {
          auth: passwords.resolve(auth.password).apply((pass) => {
            return {
              enabled: true,
              rootPassword: pass,
              usernames: [auth.user],
              databases: [auth.database],
              passwords: [pass],
            };
          }),
          persistence: persistence,
          nodeSelector: args.nodeSelector,
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

    const svcName = `${name}-mongodb`;
    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.connectionDetails = pulumi
      .all([args.namespace, passwords.resolve(auth.password)])
      .apply(([ns, pass]) => {
        return {
          database: auth.database,
          endpoint: `mongodb://${auth.user}:${pass}@${svcName}.${ns}.svc.cluster.local/${auth.database}`,
        };
      });

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
      adminPassword: passwords.resolve(auth.password),
      connectionDetails: this.connectionDetails,
    });
  }
}

export interface MongoDBArgs {
  namespace: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  resources?: ResourceRequirements;

  auth?: MongoDBAuth;
  storage: Storage;
}

export interface MongoDBAuth {
  user: string;
  database: string;
  password: Password;
}

type Storage =
  | (NewStorageClaim & { type: "new" })
  | (ExistingStorageClaim & { type: "existing" });

export interface MongoDbConnectionDetails {
  endpoint: string;
  database: string;
}
