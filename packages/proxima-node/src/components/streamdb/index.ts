import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as _ from "lodash";
import * as yaml from "js-yaml";
import * as helpers from "../../helpers";
import { Password, ResourceRequirements } from "../types";
import { PasswordResolver } from "../../helpers";

export interface StreamDBArgs {
  namespace: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  storage: pulumi.Input<{
    connectionString: string;
    db: string;
    streams: { id: string; collection: string }[];
  }>;
  relayer?: pulumi.Input<{
    streams: Record<string, { name: string; connectTo: string }>;
  }>;
  imagePullSecrets?: pulumi.Input<string[]>;
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
  imageTag?: pulumi.Input<string>;
}

export interface StreamDBConnectionDetails {
  endpoints: string[];
}

const defaultImageTag = "services:stream-db-0.1.2-303277c";
const appPort = 50051;
const metricsPort = 2112;
/**
 * Installs Proxima App with given metadata
 */
export class StreamDB extends pulumi.ComponentResource {
  public readonly config: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly ingress?: k8s.networking.v1.Ingress;
  public readonly connectionDetails: pulumi.Output<StreamDBConnectionDetails>;
  public readonly publicConnectionDetails?: pulumi.Output<StreamDBConnectionDetails>;

  public constructor(
    name: string,
    args: StreamDBArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:StreamDB", name, args, opts);
    const labels: Record<string, string> = {
      app: name,
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
          "config.yml": pulumi.all([args.storage, args.relayer]).apply(([storage, relayer]) =>
            yaml.dump(
              {
                storage: storage,
                relayer: relayer || {},
              },
              { indent: 2 }
            )
          ),
        },
      },
      { parent: this }
    );

    const imageTag = args.imageTag
      ? pulumi.Output.create(args.imageTag)
      : pulumi.Output.create(defaultImageTag);

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
                    "quay.io/proxima.one/",
                    imageTag
                  ),
                  name: "app",
                  env: [
                    {
                      name: "STREAMING_BATCH_SIZE",
                      value: "500",
                    },
                    {
                      name: "STREAMING_SLEEP_INTERVAL",
                      value: "50",
                    },
                  ],
                  ports: [
                    {
                      name: "app",
                      containerPort: appPort,
                    },
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
          labels: {
            // todo: add prometheus metrics
          },
        },
        spec: {
          selector: labels,
          ports: [
            {
              name: "app",
              protocol: "TCP",
              port: appPort,
              targetPort: appPort,
            },
            {
              name: "metrics",
              port: metricsPort,
              targetPort: metricsPort,
            },
          ],
        },
      },
      { parent: this }
    );

    this.connectionDetails = pulumi
      .all([args.namespace, this.service.metadata.name])
      .apply(([ns, svcName]) => {
        return {
          endpoints: [`${svcName}.${ns}.svc.cluster.local:${appPort}`],
        };
      });

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
            }),
          },
          spec: helpers.ingressSpec({
            host: args.publicHost,
            path: "/",
            backend: {
              service: {
                name: this.service.metadata.name,
                port: appPort,
              },
            },
            tls: {
              secretName: this.service.metadata.name.apply((x) => `${x}-tls`),
            },
          }),
        },
        { parent: this }
      );

      this.publicConnectionDetails = pulumi
        .all([pulumi.Output.create(args.publicHost)])
        .apply(([hostOrHosts]) => {
          const hosts = Array.isArray(hostOrHosts)
            ? hostOrHosts
            : [hostOrHosts];
          return {
            endpoints: hosts.map((x) => `${x}:433`),
          };
        });
    }

    this.registerOutputs();
  }
}
