import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { HelmMeta, HelmOverride, Persistence } from "../../interfaces";
import * as random from "@pulumi/random";
import { merge } from "lodash";

export interface PrometheusArgs {
  namespace?: pulumi.Input<string>;
  persistence: {
    prometheus: Persistence;
    grafana: Persistence;
    alertManager: Persistence;
  };
  helmOverride?: HelmOverride;
  ingress?: {
    alertUrl?: string;
    promUrl?: string;
    grafanaUrl?: string;
    oauthUrl?: pulumi.Input<string>;
    certificateIssuer?: string;
  };
  lokiUrl?: pulumi.Input<string>;
  pagerDuty?: {
    url: pulumi.Input<string>;
    secret: pulumi.Input<string>;
  };
}

export interface UserPassword {
  user: string;
  password: string;
}

export interface PrometheusOutputs {
  status: pulumi.Output<k8s.types.output.helm.v3.ReleaseStatus>;
  grafanaAdmin: pulumi.Output<UserPassword>;
}

/*
Deploys kube-prometheus-stack including Grafana
 */
export class PrometheusStack
  extends pulumi.ComponentResource
  implements PrometheusOutputs
{
  public readonly grafanaAdmin: pulumi.Output<UserPassword>;
  public readonly status: pulumi.Output<k8s.types.output.helm.v3.ReleaseStatus>;
  private readonly meta: pulumi.Output<HelmMeta>;

  constructor(
    name: string,
    args: PrometheusArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:PrometheusStack", name, args, opts);

    this.meta = pulumi.output<HelmMeta>({
      chart: "kube-prometheus-stack",
      version: args.helmOverride?.version ?? "39.11.0",
      repo: "https://prometheus-community.github.io/helm-charts",
    });

    const password = new random.RandomPassword(
      `${name}-admin-password`,
      {
        length: 32,
        special: false,
      },
      { parent: this }
    );

    const prom = new k8s.helm.v3.Release(
      name,
      {
        namespace: args?.namespace,
        chart: this.meta.apply((meta) => meta.chart),
        repositoryOpts: { repo: this.meta.apply((meta) => meta.repo) },
        values: merge(
          {},
          {
            prometheusOperator: {
              createCustomResource: false,
              tls: { enabled: false },
              admissionWebhooks: { enabled: false },
            },
            coreDns: { enabled: false },
            kubeDns: { enabled: true },
            grafana: {
              adminPassword: password.result,
              ingress: args.ingress?.grafanaUrl
                ? {
                    enabled: true,
                    annotations: {
                      "kubernetes.io/ingress.class": "nginx",
                      "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                      "cert-manager.io/cluster-issuer":
                        args.ingress.certificateIssuer ?? "letsencrypt",
                    },
                    hosts: [args.ingress.grafanaUrl],
                    tls: [
                      {
                        secretName: "tls-lets",
                        hosts: [args.ingress.grafanaUrl],
                      },
                    ],
                  }
                : { enabled: false },
              persistence: {
                enabled: args.persistence.grafana.enabled,
                storageClassName: args.persistence.grafana.storageClass,
                size: `${args.persistence.grafana.sizeGB}Gi`,
              },
              // additionalDataSources: [
              //   {
              //     name: "Loki",
              //     type: "Loki",
              //     url: "http://loki:3100",
              //   },
              // ],
              rbac: { pspEnabled: false },
            },
            prometheus: {
              ingress:
                args.ingress?.promUrl && args.ingress?.oauthUrl
                  ? {
                      enabled: true,
                      hosts: [args.ingress.promUrl],
                      tls: [
                        {
                          secretName: "tls-lets-pr",
                          hosts: [args.ingress.promUrl],
                        },
                      ],
                      annotations: {
                        "nginx.ingress.kubernetes.io/auth-signin": pulumi.interpolate`https://${args.ingress.oauthUrl}/oauth2/start`,
                        "nginx.ingress.kubernetes.io/auth-url": pulumi.interpolate`https://${args.ingress.oauthUrl}/oauth2/auth`,
                        "cert-manager.io/cluster-issuer": "letsencrypt",
                        "kubernetes.io/ingress.class": "nginx",
                        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                      },
                    }
                  : { enabled: false },
              storageSpec: {
                volumeClaimTemplate: {
                  spec: {
                    storageClassName: args.persistence.prometheus.storageClass,
                    accessModes: ["ReadWriteOnce"],
                    resources: {
                      requests: {
                        storage: `${args.persistence.prometheus.sizeGB}Gi`,
                      },
                    },
                  },
                  selector: {},
                },
              },
              prometheusSpec: {
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
              },
            },
            // additionalPrometheusRulesMap: {
            //   "rule-name": {
            //     groups: [
            //       {
            //         name: "proxima",
            //         rules: [
            //           {
            //             alert: "Pods Down",
            //             expr: "up{}==0",
            //             for: "0m",
            //             labels: {
            //               severity: "critical"
            //             },
            //             annotations: {
            //               summary: "Pod down (Container {{ $labels.pod }})"
            //             }
            //           }
            //         ]
            //       },
            //     ]
            //   }
            // },
            alertmanager: {
              enabled: true,
              storage: {
                volumeClaimTemplate: {
                  spec: {
                    storageClassName:
                      args.persistence.alertManager.storageClass,
                    accessModes: ["ReadWriteOnce"],
                    resources: {
                      requests: {
                        storage: `${args.persistence.alertManager.sizeGB}Gi`,
                      },
                    },
                  },
                  selector: {},
                },
              },
              // alertmanagerSpec: {
              //   logLevel: "info",
              // },
              ...(args.pagerDuty
                ? {
                    config: {
                      global: {
                        pagerduty_url: args.pagerDuty.url,
                      },
                      route: {
                        receiver: "alertOperator",
                        group_by: ["job"],
                        routes: [
                          {
                            receiver: "null",
                            matchers: ['alertname=~"InfoInhibitor|Watchdog"'],
                          },
                        ],
                      },
                      receivers: [
                        {
                          name: "alertOperator",
                          pagerduty_configs: [
                            { service_key: args.pagerDuty.secret },
                          ],
                        } as any,
                        {
                          name: "null",
                        },
                      ],
                    },
                  }
                : {}),
              ingress:
                args.ingress?.alertUrl && args.ingress?.oauthUrl
                  ? {
                      enabled: true,
                      annotations: {
                        "nginx.ingress.kubernetes.io/auth-url": `https://${args.ingress.oauthUrl}/oauth2/auth`,
                        "nginx.ingress.kubernetes.io/auth-signin": `https://${args.ingress.oauthUrl}/oauth2/start`,
                        "kubernetes.io/ingress.class": "nginx",
                        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                        "cert-manager.io/cluster-issuer": "letsencrypt",
                      },
                      hosts: [args.ingress.alertUrl],
                      tls: [
                        {
                          secretName: "tls-lets-al",
                          hosts: [args.ingress.alertUrl],
                        },
                      ],
                    }
                  : { enabled: false },
            },
          },
          args.helmOverride?.values
        ),
      },
      { parent: this }
    );

    this.status = prom.status;
    this.grafanaAdmin = password.result.apply((pass) => ({
      user: "admin",
      password: pass,
    }));
  }
}

// pagerduty optional, alertmanager - not
// dashboards to grafana
