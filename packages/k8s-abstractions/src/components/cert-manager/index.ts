import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { HelmMeta } from "../../interfaces";

export interface CertManagerArgs {
  namespace?: pulumi.Input<string>;
  version?: string;

  replicas?: number;

  letsencrypt?: {
    enabled: boolean;
    /**
     * Email address used for ACME registration
     */
    email?: string;
    staging?: boolean;
  };

  zerossl?: {
    enabled: boolean;
    keyId: pulumi.Input<string>;
    hmacKey: pulumi.Input<string>;
  };
}

export type CertificateIssuer = "letsencrypt" | "letsencrypt-stage" | "zerossl";
/**
 * @noInheritDoc
 */
export class CertManager extends pulumi.ComponentResource {
  private readonly meta: pulumi.Output<HelmMeta>;
  public readonly issuers: CertificateIssuer[];

  public constructor(
    name: string,
    args: CertManagerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:CertManager", name, args, opts);

    this.issuers = [];
    this.meta = pulumi.output<HelmMeta>({
      chart: "cert-manager",
      version: args?.version ?? "v1.9.1",
      repo: "https://charts.jetstack.io",
    });

    const chart = new k8s.helm.v3.Release(
      name,
      {
        namespace: args.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        repositoryOpts: {
          repo: this.meta.repo,
        },
        //transformations: [removeHelmTests()],
        values: {
          replicaCount: args.replicas ?? 1,
          installCRDs: true,
          webhook: {
            timeoutSeconds: 30,
          },
        },
      },
      { parent: this }
    );

    //
    // const certMgrReady = chart.resources.apply((m: Record<string, unknown>) =>
    //   pulumi.all(m).apply((m) => Object.values(m).map((r) => pulumi.output(r)))
    // );
    // const webhookSvc = pulumi
    //   .all([certMgrReady, args.namespace])
    //   .apply(([c, ns]) => {
    //     return chart.getResource(
    //       "v1/Service",
    //       ns,
    //       `${name}-cert-manager-webhook`
    //     );
    //   });

    if (args.zerossl?.enabled) {
      this.issuers.push("zerossl");

      const hmacSecret = new k8s.core.v1.Secret(
        `${name}-zerossl-hmac-key`,
        {
          metadata: {
            namespace: args.namespace,
          },
          data: {
            secret: pulumi
              .output(args.zerossl.hmacKey)
              .apply((x) => Buffer.from(x).toString("base64")),
          },
        },
        { parent: this }
      );

      const zeroSslIssuer = new k8s.apiextensions.CustomResource(
        `${name}-zerossl`,
        {
          apiVersion: "cert-manager.io/v1",
          kind: "ClusterIssuer",
          metadata: {
            name: "zerossl",
            annotations: {
              //webhook: webhookSvc.id,
            },
          },
          spec: {
            acme: {
              server: "https://acme.zerossl.com/v2/DV90",
              externalAccountBinding: {
                keyID: args.zerossl.keyId,
                keySecretRef: {
                  name: hmacSecret.metadata.name,
                  key: "secret",
                },
              },
              privateKeySecretRef: {
                name: `${name}-zerossl-private-key`,
              },
              solvers: [
                {
                  http01: {
                    ingress: {
                      class: "nginx",
                    },
                  },
                },
              ],
            },
          },
        },
        { parent: this, dependsOn: [chart] }
      );
    }

    if (args.letsencrypt) {
      this.issuers.push("letsencrypt");

      const letsencryptIssuer = new k8s.apiextensions.CustomResource(
        `${name}-letsencrypt`,
        {
          apiVersion: "cert-manager.io/v1",
          kind: "ClusterIssuer",
          metadata: {
            name: "letsencrypt",
            annotations: {
              //webhook: webhookSvc.id,
            },
          },
          spec: {
            acme: {
              server: "https://acme-v02.api.letsencrypt.org/directory",
              email: args.letsencrypt.email,
              privateKeySecretRef: {
                name: `${name}-letsencrypt-private-key`,
              },
              solvers: [
                {
                  http01: {
                    ingress: {
                      class: "nginx",
                    },
                  },
                },
              ],
            },
          },
        },
        { parent: this, dependsOn: [chart] }
      );

      if (args.letsencrypt.staging) {
        this.issuers.push("letsencrypt-stage");

        const letsencryptIssuerStage = new k8s.apiextensions.CustomResource(
          `${name}-letsencrypt-stage`,
          {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
              name: "letsencrypt-stage",
              annotations: {
                //webhook: webhookSvc.id,
              },
            },
            spec: {
              acme: {
                server:
                  "https://acme-staging-v02.api.letsencrypt.org/directory",
                email: args.letsencrypt.email,
                privateKeySecretRef: {
                  name: `${name}-letsencrypt-stage-private-key`,
                },
                solvers: [
                  {
                    http01: {
                      ingress: {
                        class: "nginx",
                      },
                    },
                  },
                ],
              },
            },
          },
          { parent: this, dependsOn: [chart] }
        );
      }
    }
  }
}
