import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as components from "../components";
import { Persistence } from "../interfaces";
import { KubernetesDeployer } from "./base";
import { CertificateIssuer } from "../components/cert-manager";
import { KafkaOperator } from "../components/kafka";
import { MinioOperator } from "../components/minio";

export class KubernetesOpsDeployer extends KubernetesDeployer {
  public deploy(args: KubernetesOperatorsArgs): DeployedKubernetesOps {
    const certificateIssuer = args.certificateIssuer ?? "letsencrypt";
    const storageClasses: Record<string, k8s.storage.v1.StorageClass> = {};
    const getPersistenceDependencies = (
      persistence: Persistence
    ): pulumi.Resource[] => {
      if (!persistence.storageClass) return [];

      const justCreatedStorageClass = storageClasses[persistence.storageClass];
      if (!justCreatedStorageClass) return [];
      return [justCreatedStorageClass];
    };
    if (args.storageClasses) {
      for (const item of args.storageClasses)
        storageClasses[item.name] = new k8s.storage.v1.StorageClass(
          item.name,
          item.args,
          this.resourceOptions()
        );
    }

    let ingressController:
      | components.ingressNginx.IngressNginxController
      | undefined;
    if (!args.ingress.disabled) {
      const ingressControllerNS = new k8s.core.v1.Namespace(
        args.ingress.namespace,
        {
          metadata: {
            name: args.ingress.namespace,
          },
        },
        this.resourceOptions()
      );

      ingressController = new components.ingressNginx.IngressNginxController(
        "ingress-ctrl",
        {
          namespace: ingressControllerNS.metadata.name,
        },
        this.resourceOptions()
      );
    }

    let certManager: components.certManager.CertManager | undefined;
    if (!args.certManager.disabled) {
      const certManagerNS = new k8s.core.v1.Namespace(
        args.certManager.namespace,
        {
          metadata: {
            name: args.certManager.namespace,
          },
        },
        this.resourceOptions()
      );

      certManager = new components.certManager.CertManager(
        "cert-manager",
        {
          namespace: certManagerNS.metadata.name,
          zerossl: args.certManager.zerossl,
          letsencrypt: args.certManager.letsencrypt,
        },
        this.resourceOptions()
      );
    }

    let oauth: components.oauth2.Oauth | undefined;
    if (!args.oauth.disabled) {
      const oauthNS = new k8s.core.v1.Namespace(
        args.oauth.namespace,
        {
          metadata: {
            name: args.oauth.namespace,
          },
        },
        this.resourceOptions()
      );

      const pass = new random.RandomPassword("oauth-cookie-secret", {
        length: 32,
      });

      // the same as (openssl rand -base64 32 | head -c 32 | base64) https://github.com/oauth2-proxy/manifests/blob/main/helm/oauth2-proxy/values.yaml#L15
      const secretValue = pass.result.apply((x) =>
        Buffer.from(
          Buffer.from(x).toString("base64").substring(0, 32)
        ).toString("base64")
      );

      oauth = new components.oauth2.Oauth(
        "oauth",
        {
          namespace: oauthNS.metadata.name,
          provider: {
            type: "github",
            org: args.oauth.github.org,
            clientId: args.oauth.github.clientId,
            clientSecret: args.oauth.github.clientSecret,
            cookieSecret: secretValue,
          },
          ingress: {
            host: `oauth.${args.publicHost}`,
            certificateIssuer: certificateIssuer,
          },
          domain: args.publicHost,
          emailDomains: args.oauth.emailDomains,
        },
        this.resourceOptions()
      );
    }

    let loki: components.loki.Loki | undefined;
    let prometheus: components.prometheus.PrometheusStack | undefined;
    if (!args.monitoring.disabled) {
      const monitoringNS = new k8s.core.v1.Namespace(
        args.monitoring.namespace,
        {
          metadata: {
            name: args.monitoring.namespace,
          },
        },
        this.resourceOptions()
      );

      loki = new components.loki.Loki(
        "loki",
        {
          namespace: monitoringNS.metadata.name,
          persistence: args.monitoring.loki.persistence,
          retentionHours: args.monitoring.loki.retentionHours,
        },
        this.resourceOptions({
          dependsOn: getPersistenceDependencies(
            args.monitoring.loki.persistence
          ),
        })
      );

      prometheus = new components.prometheus.PrometheusStack(
        "prometheus",
        {
          namespace: monitoringNS.metadata.name,
          persistence: {
            prometheus: args.monitoring.prometheus.persistence,
            grafana: args.monitoring.grafana.persistence,
            alertManager: args.monitoring.alertManager.persistence,
          },
          ingress: {
            alertHost: `al.${args.publicHost}`,
            oauthUrl: oauth?.publicHost,
            certificateIssuer: certificateIssuer,
            grafanaHost: `grafana.${args.publicHost}`,
            promHost: `prom.${args.publicHost}`,
          },
          pagerDuty: args.monitoring.alertManager.pagerDuty
            ? {
                secret: args.monitoring.alertManager.pagerDuty.secret,
                url: args.monitoring.alertManager.pagerDuty.url,
              }
            : undefined,
        },
        this.resourceOptions({
          dependsOn: [
            ...getPersistenceDependencies(
              args.monitoring.prometheus.persistence
            ),
            ...getPersistenceDependencies(args.monitoring.grafana.persistence),
          ],
        })
      );
    }

    let kafkaOperator: KafkaOperator | undefined;
    if (!args.kafka.disabled) {
      const namespace = new k8s.core.v1.Namespace(
        args.kafka.namespace,
        {
          metadata: {
            name: args.kafka.namespace,
          },
        },
        this.resourceOptions()
      );

      kafkaOperator = new KafkaOperator(
        "kafka-operator",
        {
          namespace: namespace.metadata.name,
          watchAnyNamespace: args.kafka.watchAnyNamespace,
          watchNamespaces: args.kafka.watchNamespaces,
        },
        this.resourceOptions()
      );
    }

    let minioOperator: MinioOperator | undefined;
    if (!args.minio.disabled) {
      const namespace = new k8s.core.v1.Namespace(
        args.minio.namespace,
        {
          metadata: {
            name: args.minio.namespace,
          },
        },
        this.resourceOptions()
      );

      minioOperator = new MinioOperator(
        "minio-operator",
        {
          namespace: namespace.metadata.name,
          ingress: {
            consoleHost: `minio-operator.${args.publicHost}`,
            certificateIssuer: certificateIssuer,
          },
        },
        this.resourceOptions({ dependsOn: certManager })
      );
    }
    const operators: DeployedOperator[] = [];
    if (certManager) operators.push("cert-manager");
    if (prometheus) operators.push("prometheus");
    if (kafkaOperator) operators.push("kafka");
    if (minioOperator) operators.push("minio");

    return {
      ingressIP: ingressController?.publicIP,
      grafana: prometheus
        ? {
            user: prometheus.grafanaAdmin.user,
            password: prometheus.grafanaAdmin.password,
          }
        : undefined,
      operators: operators,
      certificateIssuers: certManager?.issuers ?? [],
      host: pulumi.output(args.publicHost),
    };
  }

  public deployDefaultGcp(
    customization: (args: KubernetesOperatorsArgs) => void
  ): DeployedKubernetesOps {
    const cfg = new pulumi.Config();
    const host = `cluster.${this.params.name}.proxima.one`;
    const args: KubernetesOperatorsArgs = {
      publicHost: host,
      ingress: { namespace: "ingress" },
      kafka: {
        watchAnyNamespace: true,
        watchNamespaces: [],
        namespace: "kafka-operator",
      },
      minio: {
        namespace: "minio-operator",
      },
      certificateIssuer: "zerossl",
      certManager: {
        namespace: "cert-manager",
        letsencrypt: {
          enabled: true,
          email: "admin@proxima.one",
          staging: false,
        },
        zerossl: {
          enabled: true,
          keyId: cfg.require("zerossl.key"),
          hmacKey: cfg.require("zerossl.hmac"),
        },
      },
      monitoring: {
        namespace: "monitoring",
        loki: {
          retentionHours: 30 * 24,
          persistence: {
            enabled: true,
            sizeGB: 20,
            storageClass: "premium-rwo",
          },
        },
        prometheus: {
          persistence: {
            enabled: true,
            sizeGB: 10,
            storageClass: "premium-rwo",
          },
        },
        alertManager: {
          persistence: {
            enabled: true,
            sizeGB: 2,
            storageClass: "premium-rwo",
          },
          pagerDuty: {
            url: "https://events.pagerduty.com/generic/2010-04-15/create_event.json",
            secret: cfg.require("pagerduty.key"),
          },
        },
        grafana: {
          persistence: {
            enabled: true,
            sizeGB: 10,
            storageClass: "premium-rwo",
          },
        },
      },
      storageClasses: [
        {
          name: "premium-rwo-xfs",
          args: {
            provisioner: "pd.csi.storage.gke.io",
            metadata: {
              name: "premium-rwo-xfs",
            },
            parameters: {
              type: "pd-ssd",
              "csi.storage.k8s.io/fstype": "xfs",
            },
            allowVolumeExpansion: true,
            reclaimPolicy: "Delete",
            volumeBindingMode: "WaitForFirstConsumer",
          },
        },
      ],
      oauth: {
        namespace: "oauth",
        github: {
          org: "proxima-one",
          clientId: cfg.require("oauth.clientid"),
          clientSecret: cfg.require("oauth.clientsecret"),
        },
        emailDomains: ["*"],
      },
    };
    customization(args);
    return this.deploy(args);
  }
}

//
// public deployDashboards(args: GrafanaDashboardsArgs) {
//   new k8s.core.v1.ConfigMap(dashboard.name, {
//     metadata: {
//       name: dashboard.name,
//       labels: {
//         grafana_dashboard: "1",
//       },
//       namespace: args?.namespace
//     },
//     data: dashboard.data,
//   }, {parent: this})
//
// }

//
// export interface GrafanaDashboardsArgs {
//   data: Record<string, string | Buffer>;
// }

export interface DeployedKubernetesOps {
  ingressIP?: pulumi.Output<string>;
  grafana?: {
    user: pulumi.Output<string>;
    password: pulumi.Output<string>;
  };
  certificateIssuers: CertificateIssuer[];
  operators: DeployedOperator[];
  host: pulumi.Output<string>;
}

export type DeployedOperator =
  | "kafka"
  | "minio"
  | "cert-manager"
  | "prometheus";

export interface SubsystemBase {
  disabled?: false;
  namespace: string;
}

export interface Disabled {
  disabled: true;
}

export interface KubernetesOperatorsArgs {
  publicHost: string;
  ingress: ({} & SubsystemBase) | Disabled;
  certificateIssuer?: string;
  certManager:
    | ({
        letsencrypt?: {
          enabled: boolean;
          email?: string;
          staging?: boolean;
        };
        zerossl?: {
          enabled: boolean;
          keyId: string;
          hmacKey: string;
        };
      } & SubsystemBase)
    | Disabled;
  monitoring:
    | ({
        prometheus: {
          persistence: Persistence;
        };
        alertManager: {
          persistence: Persistence;
          pagerDuty?: {
            url: pulumi.Input<string>;
            secret: pulumi.Input<string>;
          };
        };
        loki: {
          retentionHours: number;
          persistence: Persistence;
        };
        grafana: {
          persistence: Persistence;
        };
      } & SubsystemBase)
    | Disabled;
  oauth:
    | ({
        github: {
          org: string;
          clientId: string;
          clientSecret: string;
        };
        emailDomains: string[];
      } & SubsystemBase)
    | Disabled;
  kafka:
    | ({
        watchNamespaces: pulumi.Input<string[]>;
        watchAnyNamespace: boolean;
      } & SubsystemBase)
    | Disabled;
  minio: ({} & SubsystemBase) | Disabled;
  storageClasses?: { name: string; args: k8s.storage.v1.StorageClassArgs }[];
}
