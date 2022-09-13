import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as components from "../components";
import { Persistence } from "../interfaces";
import { KubernetesDeployer } from "./base";
import { CertificateIssuer } from "../components/cert-manager";
import { KafkaOperator } from "../components/kafka";
import { MinioOperator } from "../components/minio";

export class KubernetesOperatorsDeployer extends KubernetesDeployer {
  public deploy(args: KubernetesOperatorsArgs): DeployedCluster {
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
          { provider: this.provider }
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
        { provider: this.provider }
      );

      ingressController = new components.ingressNginx.IngressNginxController(
        "ingress-ctrl",
        {
          namespace: ingressControllerNS.metadata.name,
        },
        { provider: this.provider }
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
        { provider: this.provider }
      );

      certManager = new components.certManager.CertManager(
        "cert-manager",
        {
          namespace: certManagerNS.metadata.name,
          zerossl: args.certManager.zerossl,
          letsencrypt: args.certManager.letsencrypt,
        },
        { provider: this.provider }
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
        { provider: this.provider }
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
        { provider: this.provider }
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
        { provider: this.provider }
      );

      loki = new components.loki.Loki(
        "loki",
        {
          namespace: monitoringNS.metadata.name,
          persistence: args.monitoring.loki.persistence,
          retentionHours: args.monitoring.loki.retentionHours,
        },
        {
          provider: this.provider,
          dependsOn: getPersistenceDependencies(
            args.monitoring.loki.persistence
          ),
        }
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
        {
          provider: this.provider,
          dependsOn: [
            ...getPersistenceDependencies(
              args.monitoring.prometheus.persistence
            ),
            ...getPersistenceDependencies(args.monitoring.grafana.persistence),
          ],
        }
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
        { provider: this.provider }
      );

      kafkaOperator = new KafkaOperator(
        "kafka-operator",
        {
          namespace: namespace.metadata.name,
          watchAnyNamespace: args.kafka.watchAnyNamespace,
          watchNamespaces: args.kafka.watchNamespaces,
        },
        { provider: this.provider }
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
        { provider: this.provider }
      );

      minioOperator = new MinioOperator(
        "kafka-operator",
        {
          namespace: namespace.metadata.name,
          ingress: {
            consoleHost: `minio-operator.${args.publicHost}`,
            certificateIssuer: certificateIssuer,
          },
        },
        { provider: this.provider }
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
    };
  }

  public deployDefault(
    customization: (args: KubernetesOperatorsArgs) => void
  ): DeployedCluster {
    const args: KubernetesOperatorsArgs = {
      monitoring: { disabled: true },
      certManager: { disabled: true },
      ingress: { disabled: true },
      oauth: { disabled: true },
      publicHost: `${this.params.name}.cluster.proxima.one`,
      kafka: { disabled: true },
      minio: { disabled: true },
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

export interface DeployedCluster {
  ingressIP?: pulumi.Output<string>;
  grafana?: {
    user: pulumi.Output<string>;
    password: pulumi.Output<string>;
  };
  certificateIssuers: CertificateIssuer[];
  operators: DeployedOperator[];
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
