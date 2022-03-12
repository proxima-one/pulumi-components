import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";

import {
  ExistingStorageClaim,
  NewStorageClaim,
  Password,
  ResourceRequirements,
} from "../types";
import { EnablePersistence, PersistentVolumeSize } from "../mongodb/values";

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class PostgreSQL extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create MongoDB instance
   */
  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;

  public readonly connectionDetails: pulumi.Output<PostgreSQLConnectionDetails>;

  public constructor(
    name: string,
    args: PostgreSQLArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:PostgreSQL", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);
    const auth: PostgreSQLAuth = args.auth ?? {
      user: "root",
      database: name,
      password: {
        type: "random",
        name: `${name}-secret`,
      },
    };

    const persistence: Record<string, any> = { enabled: true };
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
        chart: "postgresql",
        version: "11.1.1",
        namespace: args.namespace,
        values: {
          auth: passwords.resolve(auth.password).apply((pass) => {
            return {
              enablePostgresUser: false,
              username: auth.user,
              database: auth.database,
              password: pass,
            };
          }),
          primary: {
            persistence: persistence,
            nodeSelector: args.nodeSelector,
            extendedConfiguration: args.extendedConfiguration ?? "",
            resources: args.resources ?? {
              requests: {
                cpu: "200m",
                memory: "500Mi",
              },
              limits: {
                cpu: "2000m",
                memory: "5Gi",
              },
            },
          },
        },
      },
      { parent: this }
    );

    const svcName = `${name}-postgresql`;
    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.connectionDetails = pulumi
      .all([args.namespace, passwords.resolve(auth.password)])
      .apply(([ns, pass]) => {
        return {
          database: auth.database,
          endpoint: `postgresql://${auth.user}:${pass}@${svcName}.${ns}.svc.cluster.local:5432/${auth.database}`,
        };
      });

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
      connectionDetails: this.connectionDetails,
    });
  }
}

export interface PostgreSQLArgs {
  namespace: pulumi.Input<string>;
  resources?: ResourceRequirements;

  extendedConfiguration?: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  auth?: PostgreSQLAuth;
  storage: Storage;
}

export interface PostgreSQLAuth {
  user: string;
  database: string;
  password: Password;
}

type Storage =
  | (NewStorageClaim & { type: "new" })
  | (ExistingStorageClaim & { type: "existing" });

export interface PostgreSQLConnectionDetails {
  endpoint: string;
  database: string;
}
