import {
  DeployedKubernetesOps,
  KubernetesOperatorsArgs,
  KubernetesOpsDeployer,
} from "./ops";
import * as pulumi from "@pulumi/pulumi";

export class GkeOpsDeployer extends KubernetesOpsDeployer {
  public deployDefault(
    customization: (args: KubernetesOperatorsArgs) => void
  ): DeployedKubernetesOps {
    const cfg = new pulumi.Config();
    const host = `cluster.${this.name}.proxima.one`;
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
          pagerDuty: cfg.get("pagerduty.key")
            ? {
                url: "https://events.pagerduty.com/generic/2010-04-15/create_event.json",
                secret: cfg.require("pagerduty.key"),
              }
            : undefined,
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
          deployArgs: {
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
          labels: {
            type: "ssd",
            fstype: "xfs",
          },
        },
        {
          name: "standard-rwo-xfs",
          deployArgs: {
            provisioner: "pd.csi.storage.gke.io",
            metadata: {
              name: "standard-rwo-xfs",
            },
            parameters: {
              type: "pd-balanced",
              "csi.storage.k8s.io/fstype": "xfs",
            },
            allowVolumeExpansion: true,
            reclaimPolicy: "Delete",
            volumeBindingMode: "WaitForFirstConsumer",
          },
          labels: {
            type: "balanced",
            fstype: "xfs",
          },
        },
        {
          name: "standard-xfs",
          deployArgs: {
            provisioner: "pd.csi.storage.gke.io",
            metadata: {
              name: "standard-xfs",
            },
            parameters: {
              type: "pd-standard",
              "csi.storage.k8s.io/fstype": "xfs",
            },
            allowVolumeExpansion: true,
            reclaimPolicy: "Delete",
            volumeBindingMode: "WaitForFirstConsumer",
          },
          labels: {
            type: "hdd",
            fstype: "xfs",
          },
        },
        {
          name: "premium-rwo",
          labels: {
            type: "ssd",
            fstype: "ext4",
          },
        },
        {
          name: "standard-rwo",
          labels: {
            type: "balanced",
            fstype: "ext4",
          },
        },
        {
          name: "standard",
          labels: {
            type: "hdd",
            fstype: "ext4",
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
