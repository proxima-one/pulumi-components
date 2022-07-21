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
import {MongoExpress} from "@proxima-one/pulumi-proxima-node";

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

  public readonly dbAddress: pulumi.Output<string>;

  public readonly adminPassword: pulumi.Output<string>;

  public readonly mongoExpress?: MongoExpress;

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
    this.adminPassword = passwords.resolve(auth.password);
    this.dbAddress = pulumi
      .all([args.namespace])
      .apply(([ns]) => `${svcName}.${ns}.svc.cluster.local`);

    this.connectionDetails = pulumi
      .all([args.namespace, passwords.resolve(auth.password)])
      .apply(([ns, pass]) => {
        return {
          database: auth.database,
          endpoint: `mongodb://${auth.user}:${pass}@${svcName}.${ns}.svc.cluster.local/${auth.database}`,
        };
      });

    if (args.mongoExpress) {
      const mongoExpressArgs = pulumi.output(args.mongoExpress)
      this.mongoExpress = new MongoExpress(name + "-mongo-express", {
        namespace: args.namespace,
        mongodbServer: this.dbAddress,
        mongoAdminAuth: {
          username: "root",
          password: this.adminPassword
        },
        auth: {
          username: "mongo-express",
          password: {type: "random", name: name + "-mongo-express"}
        },
        publicHost: mongoExpressArgs.endpoint
      }, opts)
    }

    this.registerOutputs({
      dbAddress: this.dbAddress,
      resolvedPasswords: this.resolvedPasswords,
      adminPassword: this.adminPassword,
      connectionDetails: this.connectionDetails,
      mongoExpress: this.mongoExpress,
    });
  }
}

export interface MongoDBArgs {
  namespace: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  resources?: ResourceRequirements;

  auth?: MongoDBAuth;
  storage: Storage;

  mongoExpress?: pulumi.Input<{
    endpoint: pulumi.Input<string>;
  }>;
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
