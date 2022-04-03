import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";

import {
  ExistingStorageClaim,
  NewStorageClaim,
  Password,
  ResourceRequirements,
} from "../types";

export interface PgAdminArgs {
  namespace: pulumi.Input<string>;
  resources?: ResourceRequirements;

  auth?: PgAdminAuth;
  publicHost?: pulumi.Input<string>;
  storage: Storage;
}

export interface PgAdminAuth {
  email: string;
  password: Password;
}

type Storage =
  | (NewStorageClaim & { type: "new" })
  | (ExistingStorageClaim & { type: "existing" });

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class PgAdmin extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create MongoDB instance
   */
  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly ingress?: k8s.networking.v1.Ingress;

  public constructor(
    name: string,
    args: PgAdminArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:PgAdmin", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);
    const auth: PgAdminAuth = args.auth ?? {
      email: "pgadmin@proxima.one",
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
          repo: "https://helm.runix.net",
        },
        chart: "pgadmin4",
        version: "1.9.6",
        namespace: args.namespace,
        values: {
          env: passwords.resolve(auth.password).apply((pass) => {
            return {
              email: auth.email,
              password: pass,
            };
          }),
          persistentVolume: {
            enabled: true,
            ...persistence,
          },
          VolumePermissions: {
            enabled: true,
          },
        },
      },
      { parent: this }
    );

    const svcName = `${name}-pgadmin4`;

    if (args.publicHost) {
      this.ingress = new k8s.networking.v1.Ingress(
        `${name}`,
        {
          metadata: {
            namespace: args.namespace,
            annotations: helpers.ingressAnnotations({
              certIssuer: "letsencrypt",
              backendGrpc: true,
              sslRedirect: true,
              bodySize: "300m",
            }),
          },
          spec: helpers.ingressSpec({
            host: args.publicHost,
            path: "/",
            backend: {
              service: {
                name: svcName,
                port: 80,
              },
            },
            tls: {
              secretName: `${svcName}-tls`,
            },
          }),
        },
        { parent: this }
      );
    }

    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
    });
  }
}
