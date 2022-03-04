import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as _ from "lodash";
import * as yaml from "js-yaml";
import * as helpers from "../../helpers";
import { Password, ResourceRequirements } from "../types";
import { PasswordResolver } from "../../helpers";

export interface BlockIndexerArgs {
  namespace: pulumi.Input<string>;
  storage: pulumi.Input<{
    type: string;
    uri: string;
    database: string;
    [key: string]: any;
  }>;
  auth: {
    password: Password;
  };
  imagePullSecrets?: pulumi.Input<string[]>;
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string>;
  imageTag?: pulumi.Input<string>;
}

export interface BlockIndexerConnectionDetails {
  endpoint: string;
  authToken: string;
}

const defaultImageTag = "0.5.2";
const appPort = 50051;
const metricsPort = 2112;
/**
 * Installs Proxima App with given metadata
 */
export class BlockIndexer extends pulumi.ComponentResource {
  public readonly config: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly ingress?: k8s.networking.v1.Ingress;
  public readonly connectionDetails: pulumi.Output<BlockIndexerConnectionDetails>;
  public readonly publicConnectionDetails?: pulumi.Output<BlockIndexerConnectionDetails>;

  public constructor(
    name: string,
    args: BlockIndexerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:BlockIndexer", name, args, opts);
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

    const passwords = new PasswordResolver(this);
    this.config = new k8s.core.v1.ConfigMap(
      name,
      {
        metadata: {
          namespace: args.namespace,
        },
        data: {
          "config.yml": pulumi
            .all([args.storage, passwords.resolve(args.auth.password)])
            .apply(([storage, password]) =>
              yaml.dump(
                {
                  storage: storage,
                  server: {
                    host: "0.0.0.0",
                    port: appPort,
                    metricsPort: metricsPort,
                    superUserToken: password,
                  },
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
              containers: [
                {
                  image: pulumi.concat(
                    "quay.io/proxima.one/block-indexer:",
                    imageTag
                  ),
                  name: "app",
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
      .all([
        args.namespace,
        this.service.metadata.name,
        passwords.resolve(args.auth.password),
      ])
      .apply(([ns, svcName, pass]) => {
        return {
          authToken: pass,
          endpoint: `${svcName}.${ns}.svc.cluster.local:${appPort}`,
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
        .all([
          pulumi.Output.create(args.publicHost),
          passwords.resolve(args.auth.password),
        ])
        .apply(([publicHost, pass]) => {
          return {
            authToken: pass,
            endpoint: `${publicHost}:433`,
          };
        });
    }

    this.registerOutputs();
  }
}
