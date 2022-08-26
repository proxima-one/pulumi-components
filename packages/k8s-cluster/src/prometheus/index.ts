import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@proxima-one/pulumi-k8s-cluster/src/abstractions';
import * as random from '@pulumi/random';
import * as fs from 'fs';

// TODO: remove id unused. Rename UPrometheus
/*
export interface PrometheusOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  persistence: pulumi.Output<abstractions.Persistence | undefined>;
}

export class Prometheus extends pulumi.ComponentResource implements PrometheusOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly persistence: pulumi.Output<abstractions.Persistence | undefined>;

  constructor(name: string, props?: PrometheusInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:Prometheus', name, props, opts);

    this.persistence = pulumi.output(props?.persistence);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'prometheus',
      version: props?.version ?? '15.3.0',
      repo: 'https://prometheus-community.github.io/helm-charts',
    });

    new k8s.helm.v3.Chart(
      name,
      {
        namespace: props?.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        fetchOpts: {
          repo: this.meta.repo,
        },
        values: {
          server: {
            retention: pulumi.interpolate`${props?.retentionHours || 168}h`,
            global: {
              scrape_interval: `${props?.scrapeIntervalSeconds ?? 60}s`,
              external_labels: props?.externalLabels,
            },
            strategy: {
              type: 'Recreate',
            },
            extraArgs: props?.extraArgs,
            extraFlags: ['storage.tsdb.wal-compression', ...(props?.extraFlags || [])],
            sidecarContainers: props?.sidecarContainers,
            persistentVolume: !props?.persistence
              ? {enabled: false}
              : {
                enabled: props?.persistence.enabled,
                size: pulumi.interpolate`${props?.persistence.sizeGB}Gi`,
                storageClass: props?.persistence.storageClass,
              },
            resources: props?.resources
              ? props?.resources
              : {
                requests: {
                  cpu: '300m',
                  memory: '1000M',
                },
                limits: {
                  cpu: '2',
                  memory: '1500M',
                },
              },
          },
          alertmanager: {
            enabled: props?.alertmanager?.enabled ?? true,
            persistentVolume: {
              enabled: false,
            },
          },
          nodeExporter: {
            enabled: props?.nodeExporter?.enabled ?? true,
            tolerations: [
              {
                key: 'node-role.kubernetes.io/master',
                operator: 'Exists',
                effect: 'NoSchedule',
              },
            ],
          },
          kubeStateMetrics: {
            enabled: props?.kubeStateMetrics?.enabled ?? true,
          },
          pushgateway: {
            enabled: props?.pushgateway?.enabled ?? false,
          },
        },
      },
      {
        parent: this,
      }
    );
  }
}
 */

export interface PrometheusInputs {
  namespace?: pulumi.Input<string>;
  version?: string;
  persistence?: abstractions.Persistence;
  alertUrl: string;
  oauthUrl: string;
  promUrl: string;
  pagerDutySecret: string;
  pagerDutyUrl: string;
  grafanaUrl: string;
}

export interface UPrometheusOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  persistence: pulumi.Output<abstractions.Persistence | undefined>;
  status: pulumi.Output<k8s.types.output.helm.v3.ReleaseStatus>;
  adminUsername: pulumi.Output<string>;
  adminPassword: pulumi.Output<string>;
}

export class UPrometheus extends pulumi.ComponentResource implements UPrometheusOutputs {
  readonly adminUsername: pulumi.Output<string>;
  readonly adminPassword: pulumi.Output<string>;
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly persistence: pulumi.Output<abstractions.Persistence | undefined>;
  readonly status: pulumi.Output<k8s.types.output.helm.v3.ReleaseStatus>

  constructor(name: string, args: PrometheusInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxyma:UPrometheus', name, args, opts);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'kube-prometheus-stack',
      version: args?.version ?? '34.5.1',
      repo: 'https://prometheus-community.github.io/helm-charts',
    });

    const password = new random.RandomPassword(`${name}-admin-password`, {
      length: 32,
      special: false,
    }, {parent: this});

    this.persistence = pulumi.output(args?.persistence)

    const prom = new k8s.helm.v3.Release(name, {
      namespace: args?.namespace,
      chart: this.meta.chart,
      repositoryOpts: {repo: this.meta.repo},
      values: {
        prometheusOperator: {
          createCustomResource: false,
          tls: {enabled: false},
          admissionWebhooks: {enabled: false}
        },
        coreDns: {enabled: false},
        kubeDns: {enabled: true},
        grafana: {
          adminPassword: password.result,
          ingress: {
            enabled: true,
            annotations: {
              "kubernetes.io/ingress.class": "nginx",
              "nginx.ingress.kubernetes.io/ssl-redirect": "true",
              "cert-manager.io/cluster-issuer": "letsencrypt"
            },
            hosts: [args.grafanaUrl],
            tls: [{secretName: "tls-lets", hosts: [args.grafanaUrl]}]
          },
          persistence: {
            enabled: true
          },
          additionalDataSources: [{
            name: "Loki",
            type: "Loki",
            url: "http://loki:3100"
          }],
          rbac: {pspEnabled: false},
        },
        prometheus: {
          ingress: {
            enabled: true,
            hosts: [args.promUrl],
            tls: [{
              "secretName": "tls-lets-pr",
              "hosts": [
                args.promUrl
              ]
            }],
            annotations: {
              "nginx.ingress.kubernetes.io/auth-signin": `https://${args.oauthUrl}/oauth2/start`,
              "nginx.ingress.kubernetes.io/auth-url": `https://${args.oauthUrl}/oauth2/auth`,
              "cert-manager.io/cluster-issuer": "letsencrypt",
              "kubernetes.io/ingress.class": "nginx",
              "nginx.ingress.kubernetes.io/ssl-redirect": "true"
            }
          },
          storageSpec: {
            volumeClaimTemplate: {
              spec: {
                storageClassName: "",
                accessModes: [
                  "ReadWriteOnce"
                ],
                resources: {
                  requests: {
                    storage: "20Gi"
                  }
                }
              },
              selector: {}
            }
          },
          prometheusSpec: {
            serviceMonitorSelectorNilUsesHelmValues: false,
            podMonitorSelectorNilUsesHelmValues: false
          }
        },
        additionalPrometheusRulesMap: {
          "rule-name": {
            groups: [
              {
                name: "proxima",
                rules: [
                  {
                    alert: "Pods Down",
                    expr: "up{}==0",
                    for: "0m",
                    labels: {
                      severity: "critical"
                    },
                    annotations: {
                      summary: "Pod down (Container {{ $labels.pod }})"
                    }
                  }
                ]
              },
            ]
          }
        },
        alertmanager: {
          alertmanagerSpec: {
            logLevel: "debug"
          },
          config: {
            global: {
              pagerduty_url: args.pagerDutyUrl
            },
            route: {
              receiver: "alertOperator",
              group_by: ["job"],
              routes: [{
                receiver: "null",
                matchers: [
                  "alertname=~\"InfoInhibitor|Watchdog\""
                ]
              }]
            },
            receivers: [
              {
                name: "alertOperator",
                pagerduty_configs: [{service_key: args.pagerDutySecret}]
              },
              {
                name: "null"
              }
            ]
          },
          ingress: {
            enabled: true,
            annotations: {
              "nginx.ingress.kubernetes.io/auth-url": `https://${args.oauthUrl}/oauth2/auth`,
              "nginx.ingress.kubernetes.io/auth-signin": `https://${args.oauthUrl}/oauth2/start`,
              "kubernetes.io/ingress.class": "nginx",
              "nginx.ingress.kubernetes.io/ssl-redirect": "true",
              "cert-manager.io/cluster-issuer": "letsencrypt"
            },
            hosts: [args.alertUrl],
            tls: [{
              secretName: "tls-lets-al",
              hosts: [args.alertUrl]
            }]
          }
        }
      },
    }, {parent: this})

    new k8s.core.v1.ConfigMap("proxima-dashboard", { // TODO: remove or move to other dir. What to do with this 300-line JSON?
      metadata: {
        name: "proxima-dashboard",
        labels: {
          grafana_dashboard: "1",
        },
        namespace: args?.namespace
      },
      data: {
        "proxima.json": fs.readFileSync("components/prometheus/proxima.json", "utf-8")
      }
    }, {parent: this})

    this.status = prom.status
    this.adminUsername = pulumi.output('admin');
    this.adminPassword = pulumi.secret(password.result);
  }

}
