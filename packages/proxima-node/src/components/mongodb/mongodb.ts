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
import { MongoExpress } from "@proxima-one/pulumi-proxima-node";

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
    const persistence = pulumi.output(args.storage).apply((storage) => {
      const res: PersistenceConfiguration = { enabled: true };
      if (storage.type == "new") {
        res.size = storage.size;
        res.storageClass = storage.class;
      } else {
        res.existingClaim = storage.name;
      }
      return res;
    });

    const replicaSet = pulumi.Output.create(args.replicaSet);
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
          replicaCount: replicaSet.apply((x) => x ?? 1),
          architecture: replicaSet.apply((x) =>
            x == undefined ? "standalone" : "replicaset"
          ),
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

    this.chart.getResource()

    const svcName = args.replicaSet
      ? `${name}-mongodb-headless`
      : `${name}-mongodb`;

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
      const mongoExpressArgs = pulumi.output(args.mongoExpress);
      this.mongoExpress = new MongoExpress(
        name + "-mongo-express",
        {
          namespace: args.namespace,
          nodeSelector: args.nodeSelector,
          mongodbServer: this.dbAddress,
          mongoAdminAuth: {
            username: "root",
            password: this.adminPassword,
          },
          auth: {
            username: "mongo-express",
            password: { type: "random", name: name + "-mongo-express" },
          },
          publicHost: mongoExpressArgs.endpoint,
        },
        { ...opts, dependsOn: this.chart }
      );
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
  resources?: pulumi.Input<ResourceRequirements>;

  auth?: MongoDBAuth;
  storage: pulumi.Input<MongoDbStorage>;
  replicaSet?: pulumi.Input<number>;

  mongoExpress?: pulumi.Input<{
    endpoint: pulumi.Input<string>;
  }>;
}

export interface MongoDBAuth {
  user: string;
  database: string;
  password: Password;
}

export type MongoDbStorage =
  | (NewStorageClaim & { type: "new" })
  | (ExistingStorageClaim & { type: "existing" });

export interface MongoDbConnectionDetails {
  endpoint: string;
  database: string;
}
