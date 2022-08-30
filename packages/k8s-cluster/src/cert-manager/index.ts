import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@proxima-one/pulumi-k8s-cluster/src/abstractions';

export interface CertManagerInputs {
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
    eabKid: string;
  };
}

export interface CertManagerOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
}

/**
 * @noInheritDoc
 */
export class CertManager extends pulumi.ComponentResource implements CertManagerOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;

  constructor(name: string, args: CertManagerInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:CertManager', name, args, opts);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'cert-manager',
      version: args?.version ?? 'v1.7.3',
      repo: 'https://charts.jetstack.io',
    });

    const chart = new k8s.helm.v3.Chart(
      name,
      {
        namespace: args.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        fetchOpts: {
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
      }, {parent: this});

    const certMgrReady = chart.resources.apply(
      (m: Record<string, unknown>) => pulumi.all(m).apply(m => Object.values(m).map(r => pulumi.output(r))));
    const webhookSvc = pulumi.all([certMgrReady, args.namespace]).apply(([c, ns]) => {
      return chart.getResource("v1/Service", ns, `${name}-cert-manager-webhook`)
    });

    if (args.zerossl?.enabled) {
      const zeroSslIssuer = new k8s.apiextensions.CustomResource(`${name}-zerossl`, {
        apiVersion: "cert-manager.io/v1",
        kind: "ClusterIssuer",
        metadata: {
          name: "zerossl",
          annotations: {
            webhook: webhookSvc.id,
          }
        },
        spec: {
          acme: {
            server: "https://acme.zerossl.com/v2/DV90",
            externalAccountBinding: {
              keyID: args.zerossl.eabKid,
              keySecretRef: {
                name: `${name}-zerossl-hmac-key`,
                key: "secret",
              },
            },
            privateKeySecretRef: {
              name: `${name}-zerossl-private-key`
            },
            solvers: [{
              http01: {
                ingress: {
                  class: "nginx"
                }
              }
            }],
          }
        }
      }, {parent: this, dependsOn: [chart]});
    }

    if (args.letsencrypt) {
      const letsencryptIssuer = new k8s.apiextensions.CustomResource(
        `${name}-letsencrypt`,
        {
          apiVersion: "cert-manager.io/v1",
          kind: "ClusterIssuer",
          metadata: {
            name: "letsencrypt",
            annotations: {
              webhook: webhookSvc.id,
            }
          },
          spec: {
            acme: {
              server: "https://acme-v02.api.letsencrypt.org/directory",
              email: args.letsencrypt.email,
              privateKeySecretRef: {
                name: `${name}-letsencrypt-private-key`
              },
              solvers: [{
                http01: {
                  ingress: {
                    class: "nginx"
                  }
                }
              }],
            }
          }
        }, {parent: this, dependsOn: [chart]});

      if (args.letsencrypt.staging) {
        const letsencryptIssuerStage = new k8s.apiextensions.CustomResource(
          `${name}-letsencrypt-stage`,
          {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
              name: "letsencrypt-stage",
              annotations: {
                webhook: webhookSvc.id,
              }
            },
            spec: {
              acme: {
                server: "https://acme-staging-v02.api.letsencrypt.org/directory",
                email: args.letsencrypt.email,
                privateKeySecretRef: {
                  name: `${name}-letsencrypt-stage-private-key`
                },
                solvers: [{
                  http01: {
                    ingress: {
                      class: "nginx"
                    }
                  }
                }],
              }
            }
          }, {parent: this, dependsOn: [chart]});
      }
    }
  }
}
