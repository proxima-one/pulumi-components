import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as yaml from "js-yaml";
import { ResourceRequirements } from "../types";

export interface StreamsMonitoringArgs {
  namespace: pulumi.Input<string>;
  storage: pulumi.Input<{
    uri: string;
    database: string;
    [key: string]: any;
  }>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  imagePullSecrets?: pulumi.Input<string[]>;
  resources?: ResourceRequirements;
  imageTag?: pulumi.Input<string>;
}

const defaultIndexerApiImageTag = "streams-monitoring-0.0.1-3656dba";
const metricsPort = 2112;
/**
 * Installs Proxima App with given metadata
 */
export class StreamsMonitoring extends pulumi.ComponentResource {
  public readonly config: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;

  public constructor(
    name: string,
    args: StreamsMonitoringArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:StreamsMonitoring", name, args, opts);
    const labels: Record<string, string> = {
      app: name,
      monitoring: "true",
    };

    const computeResources = args.resources ?? {
      requests: {
        memory: "300Mi",
        cpu: "50m",
      },
      limits: {
        memory: "6Gi",
        cpu: "2000m",
      },
    };

    this.config = new k8s.core.v1.ConfigMap(
      name,
      {
        metadata: {
          namespace: args.namespace,
        },
        data: {
          "config.yml": pulumi.all([args.storage]).apply(([storage]) =>
            yaml.dump(
              {
                storage: storage,
                server: {
                  host: "0.0.0.0",
                  metricsPort: metricsPort,
                },
              },
              { indent: 2 }
            )
          ),
        },
      },
      { parent: this }
    );

    const indexerApiImageTag = args.imageTag
      ? pulumi.Output.create(args.imageTag)
      : pulumi.Output.create(defaultIndexerApiImageTag);

    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          namespace: args.namespace,
          labels: labels,
        },
        spec: {
          selector: {
            matchLabels: labels,
          },
          strategy: {
            type: "Recreate",
          },
          template: {
            metadata: {
              labels: labels,
            },
            spec: {
              restartPolicy: "Always",
              imagePullSecrets: args.imagePullSecrets
                ? pulumi.Output.create(args.imagePullSecrets).apply((x) =>
                    x.map((y) => {
                      return { name: y };
                    })
                  )
                : undefined,
              volumes: [
                {
                  name: "config",
                  configMap: {
                    name: this.config.metadata.name,
                  },
                },
              ],
              nodeSelector: args.nodeSelector,
              containers: [
                {
                  image: pulumi.concat(
                    "quay.io/proxima.one/services:",
                    indexerApiImageTag
                  ),
                  name: "metrics",
                  ports: [
                    {
                      name: "http-metrics",
                      containerPort: metricsPort,
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "config",
                      mountPath: "/app/config.yml",
                      subPath: "config.yml",
                    },
                  ],
                  resources: computeResources,
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );

    this.service = new k8s.core.v1.Service(
      name,
      {
        metadata: {
          namespace: args.namespace,
          labels: {},
        },
        spec: {
          selector: labels,
          ports: [
            {
              name: "metrics",
              protocol: "TCP",
              port: metricsPort,
              targetPort: metricsPort,
            },
          ],
        },
      },
      { parent: this }
    );

    this.registerOutputs();
  }
}
