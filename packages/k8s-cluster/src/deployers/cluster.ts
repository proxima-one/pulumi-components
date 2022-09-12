import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as components from "../components";
import { Persistence } from "../interfaces";

export interface ClusterDeployParameters {
  name: string;
  kubeconfig: pulumi.Input<string>;
}

export class ClusterDeployer {
  private readonly provider!: k8s.Provider;

  public constructor(private readonly params: ClusterDeployParameters) {
    this.provider = new k8s.Provider(
      this.params.name,
      { kubeconfig: this.params.kubeconfig },
      {}
    );
  }

  public deploy(args: ClusterArgs): DeployedCluster {
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
    if (!args.oAuth.disabled) {
      const oauthNS = new k8s.core.v1.Namespace(
        args.oAuth.namespace,
        {
          metadata: {
            name: args.oAuth.namespace,
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
          clientId: args.oAuth.clientId,
          clientSecret: args.oAuth.clientSecret,
          cookieSecret: secretValue,
          oauthUrl: `oauth.${args.publicHost}`,
          domain: args.publicHost,
          emailDomains: args.oAuth.emailDomains,
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
          },
          ingress: {
            alertUrl: `al.${args.publicHost}`,
            oauthUrl: oauth?.oauthUrl,
            certificateIssuer: "letsencrypt",
            grafanaUrl: `grafana.${args.publicHost}`,
            promUrl: `prom.${args.publicHost}`,
          },
          pagerDuty: args.monitoring.pagerDuty
            ? {
                secret: args.monitoring.pagerDuty.secret,
                url: args.monitoring.pagerDuty.url,
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

    return {
      ingressIP: ingressController?.publicIP,
      grafana: prometheus
        ? {
            user: prometheus.grafanaAdmin.user,
            password: prometheus.grafanaAdmin.password,
          }
        : undefined,
    };
  }

  public deployDefault(
    customization: (args: ClusterArgs) => void
  ): DeployedCluster {
    const args: ClusterArgs = {
      monitoring: { disabled: true },
      certManager: { disabled: true },
      ingress: { disabled: true },
      oAuth: { disabled: true },
      publicHost: `${this.params.name}.cluster.proxima.one`,
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
}

export interface SubsystemBase {
  disabled?: false;
  namespace: string;
}

export interface Disabled {
  disabled: true;
}

export interface ClusterArgs {
  publicHost: string;
  ingress: ({} & SubsystemBase) | Disabled;
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
        loki: {
          retentionHours: number;
          persistence: Persistence;
        };
        grafana: {
          persistence: Persistence;
        };
        pagerDuty?: {
          url: pulumi.Input<string>;
          secret: pulumi.Input<string>;
        };
      } & SubsystemBase)
    | Disabled;
  oAuth:
    | ({
        clientId: string;
        clientSecret: string;
        emailDomains: string[];
      } & SubsystemBase)
    | Disabled;
  storageClasses?: { name: string; args: k8s.storage.v1.StorageClassArgs }[];
}
