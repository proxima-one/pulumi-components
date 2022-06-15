import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as yaml from "js-yaml";
import * as helpers from "../../helpers";
import { Password, ResourceRequirements } from "../types";
import { PasswordResolver } from "../../helpers";

export interface NearIndexerArgs {
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
  connection: {
    http: pulumi.Input<string>;
  };
  network: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  imagePullSecrets?: pulumi.Input<string[]>;
  resources?: ResourceRequirements;
  publicHost?: pulumi.Input<string | string[]>;
  indexerImageTag?: pulumi.Input<string>;
  indexerApiImageTag?: pulumi.Input<string>;
}

export interface NearIndexerConnectionDetails {
  endpoint: string;
  authToken: string;
}

const defaultIndexerImageTag = "near-indexer-0.1.0";
const defaultIndexerApiImageTag = "near-indexer-api-0.1.0-59db775";
const appPort = 50053;
const metricsPort = 2112;
/**
 * Installs Proxima App with given metadata
 */
export class NearIndexer extends pulumi.ComponentResource {
  public readonly config: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly ingress?: k8s.networking.v1.Ingress;
  public readonly connectionDetails: pulumi.Output<NearIndexerConnectionDetails>;
  public readonly publicConnectionDetails?: pulumi.Output<NearIndexerConnectionDetails>;

  public constructor(
    name: string,
    args: NearIndexerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:NearIndexer", name, args, opts);
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
          "config.yaml": pulumi
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

    const resolvedArgs = pulumi.output(args);

    const indexerImageTag = args.indexerImageTag
      ? pulumi.Output.create(args.indexerImageTag)
      : pulumi.Output.create(defaultIndexerImageTag);

    const indexerApiImageTag = args.indexerApiImageTag
      ? pulumi.Output.create(args.indexerApiImageTag)
      : pulumi.Output.create(defaultIndexerApiImageTag);

    if (!resolvedArgs.connection.http) {
      throw new Error("Invalid arguments: http connection is not specified.");
    }

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
                    indexerImageTag
                  ),
                  env: [
                    { name: "NETWORK", value: resolvedArgs.network },
                    { name: "NODE_URL", value: resolvedArgs.connection.http },
                    {
                      name: "MONGO_URL",
                      value: resolvedArgs.apply((x) => x.storage.uri),
                    },
                  ],
                  name: "indexer",
                  ports: [],
                  resources: computeResources,
                },
                {
                  image: pulumi.concat(
                    "quay.io/proxima.one/services:",
                    indexerApiImageTag
                  ),
                  name: "api",
                  ports: [
                    {
                      name: "api",
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
                      mountPath: "/app/config.yaml",
                      subPath: "config.yaml",
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
              name: "api",
              protocol: "TCP",
              port: appPort,
              targetPort: appPort,
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
