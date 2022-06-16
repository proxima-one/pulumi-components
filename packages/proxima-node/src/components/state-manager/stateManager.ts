import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";
import { ResourceRequirements, NewStorageClaim } from "../types";
import { PasswordResolver } from "../../helpers";

export interface StateManagerArgs {
  namespace: pulumi.Input<string>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  imagePullSecrets?: pulumi.Input<string[]>;
  imageName: pulumi.Input<string>;
  resources?: ResourceRequirements;
  storage: NewStorageClaim;
  publicHost?: pulumi.Input<string | string[]>;
}

export interface StateManagerConnectionDetails {
  endpoint: string;
}

const appPort = 50051;
const dbPath = "/run/db";

export class StateManager extends pulumi.ComponentResource {
  public readonly pvc: k8s.core.v1.PersistentVolumeClaim;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly ingress?: k8s.networking.v1.Ingress;
  public readonly connectionDetails: pulumi.Output<StateManagerConnectionDetails>;
  public readonly publicConnectionDetails?: pulumi.Output<StateManagerConnectionDetails>;

  public constructor(
    name: string,
    args: StateManagerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:StateManager", name, args, opts);
    const labels: Record<string, string> = {
      app: name,
    };

    const computeResources = args.resources ?? {
      requests: {
        memory: "1000Mi",
        cpu: "50m",
      },
      limits: {
        memory: "4000Mi",
        cpu: "100m",
      },
    };

    const passwords = new PasswordResolver(this);

    const volumeName = name;

    this.pvc = new k8s.core.v1.PersistentVolumeClaim(
      volumeName,
      {
        metadata: {
          namespace: args.namespace,
          labels: labels,
        },
        spec: {
          storageClassName: args.storage.class,
          accessModes: ["ReadWriteOnce"],
          resources: {
            requests: {
              storage: args.storage.size,
            },
          },
        },
      },
      { parent: this }
    );

    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          namespace: args.namespace,
          labels: labels,
        },
        spec: {
          replicas: 1,
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
              nodeSelector: args.nodeSelector,
              restartPolicy: "Always",
              imagePullSecrets: args.imagePullSecrets
                ? pulumi.Output.create(args.imagePullSecrets).apply((x) =>
                    x.map((name) => ({ name }))
                  )
                : undefined,
              containers: [
                {
                  image: args.imageName,
                  name: "state-manager",
                  args: [],
                  env: [
                    {
                      name: "PORT",
                      value: appPort.toString(),
                    },
                    {
                      name: "DB_PATH",
                      value: dbPath,
                    },
                  ],
                  ports: [
                    {
                      name: "grpc",
                      containerPort: appPort,
                    },
                  ],
                  volumeMounts: [
                    {
                      name: volumeName,
                      mountPath: dbPath,
                    },
                  ],
                  resources: computeResources,
                },
              ],
              volumes: [
                {
                  name: volumeName,
                  persistentVolumeClaim: {
                    claimName: this.pvc.metadata.name,
                    readOnly: false,
                  },
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
        },
        spec: {
          selector: labels,
          ports: [
            {
              name: "grpc",
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
      .all([args.namespace, this.service.metadata.name])
      .apply(([namespace, serviceName]) => {
        return {
          endpoint: `${serviceName}.${namespace}.svc.cluster.local:${appPort}`,
        };
      });

    if (args.publicHost) {
      this.ingress = new k8s.networking.v1.Ingress(
        name,
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

      this.publicConnectionDetails = pulumi.Output.create(
        args.publicHost
      ).apply((publicHost) => {
        return {
          endpoint: `${publicHost}:443`,
        };
      });
    }

    this.registerOutputs();
  }
}
