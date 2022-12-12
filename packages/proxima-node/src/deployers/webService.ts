/*
  Responsible for deployment of any proxima service app.
 */
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as _ from "lodash";
import { ingressAnnotations, ingressSpec } from "../helpers";
import {
  ComputeResources,
  KubernetesServiceDeployer,
  Storage,
} from "@proxima-one/pulumi-k8s-base";
import { strict as assert } from "assert";

export class WebServiceDeployer extends KubernetesServiceDeployer {
  public deploy(app: WebService): DeployedServiceApp {
    const name = app.name;
    const deployedParts: Record<string, DeployedPart> = {};

    for (const [partName, part] of _.entries(app.parts)) {
      if (part.disabled) continue;

      const partFullName = partName == "" ? name : `${name}-${partName}`;

      const allConfigFiles = [
        ...(app.configFiles ?? []),
        ...(part.configFiles ?? []),
      ];
      const configMap = allConfigFiles.length > 0 ? new k8s.core.v1.ConfigMap(
        `${partFullName}-config`,
        {
          metadata: {
            namespace: this.namespace,
          },
          data: allConfigFiles
            .map<[string, any]>((file) => [file.path, file.content])
            .reduce(
              (acc, [k, v]: [string, any]) => ({
                ...acc,
                [k.replace(/\//g, "_")]: v, // replace / with _ as it can't be used
              }),
              {}
            ),
        }, this.options()
      ) : undefined;

      const pvcs = pulumi.output(part.pvcs).apply(pvcs => pvcs?.map((pvcRequest, index) =>
        typeof pvcRequest.storage == "string" ? pulumi.output(pvcRequest.storage) : new k8s.core.v1.PersistentVolumeClaim(
        `${partFullName}-pvc-${index}`,
        {
          metadata: {
            namespace: this.namespace,
            annotations: {
              "pulumi.com/skipAwait": "true", // otherwise pvc is waiting for the first consumer, and first consumer is waiting for this pvc: deadlock
            },
          },
          spec: {
            storageClassName: this.storageClass(pvcRequest.storage.class, {failIfNoMatch: true}).apply(x => x!),
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: pvcRequest.storage.size,
              },
            },
          },
        }, this.options()).metadata.name
      ) ?? []);

      const imageName = pulumi
        .all([pulumi.output(app.imageName), pulumi.output(part.imageName)])
        .apply(([appImage, partImage]) => {
          const imageName = partImage ?? appImage;
          if (!imageName)
            throw new Error(`unspecified image for part ${partName}`);
          return imageName;
        });

      const metricsLabels = pulumi.output(part.metrics).apply((x) =>
        x
          ? {
              monitoring: "true",
              ...x.labels,
            }
          : {}
      );

      const matchLabels: Record<string, pulumi.Input<string>> = {
        app: partFullName,
      };

      const volumes: pulumi.Input<pulumi.Input<k8s.types.input.core.v1.Volume>[]> = [];
      if (configMap) {
        volumes.concat({
          name: "config",
          configMap: {
            name: configMap.id.apply((s) => s.split("/")[s.split("/").length - 1]),
          },
        })
      }
      pvcs.apply(pvcArr => pvcArr.forEach((pvcName, index) => volumes.concat({
        name: `pvc-${index}`,
        persistentVolumeClaim: {
          claimName: pvcName,
          readOnly: false,
        },
      })));

      const volumeMounts: pulumi.Input<pulumi.Input<k8s.types.input.core.v1.VolumeMount>[]> = [];
      volumeMounts.concat(allConfigFiles.map((file) => ({
        name: "config",
        mountPath: pulumi.output(file).apply(f => f.path),
        subPath: pulumi
          .output(file)
          .apply(f => f.path.replace(/\//g, "_")),
      })));
      pulumi.output(part.pvcs).apply(pvcRequests => pvcRequests?.forEach((pvcRequest, index) =>
        volumeMounts.concat({
          name: `pvc-${index}`,
          mountPath: pvcRequest.path
        }))
      );

      const deployment = new k8s.apps.v1.Deployment(
        partFullName,
        {
          metadata: {
            namespace: this.namespace,
          },
          spec: {
            replicas: pulumi.output(part.scale).apply((x) => x ?? 1),
            selector: {
              matchLabels: matchLabels,
            },
            strategy: part.deployStrategy
              ? {
                  type: pulumi.output(part.deployStrategy).type,
                }
              : undefined,
            template: {
              metadata: {
                labels: metricsLabels.apply((x) => ({ ...x, ...matchLabels })),
              },
              spec: {
                restartPolicy: "Always",
                imagePullSecrets: this.imagePullSecrets({ image: imageName }),
                nodeSelector: this.nodeSelectors,
                containers: [
                  {
                    image: imageName,
                    name: partFullName,
                    args: part.args,
                    env: pulumi.output(part.env).apply((env) =>
                      env
                        ? Object.entries(env).map(([key, value]) => ({
                            name: key,
                            value: value,
                          }))
                        : []
                    ),
                    ports: pulumi.output(part.ports).apply((x) =>
                      x
                        ? x.map((port) => ({
                            name: port.name,
                            containerPort: port.containerPort,
                            protocol: port.protocol ?? "TCP",
                          }))
                        : []
                    ),
                    resources: pulumi
                      .output(part.resources)
                      .apply((x) =>
                        this.getResourceRequirements(x ?? defaultResources)
                      ),
                    volumeMounts: volumeMounts,
                  },
                ],
                volumes: volumes,
              },
            },
          },
        },
        this.options()
      );

      const { service, ingresses, ingressRules } = pulumi
        .output(part.ports)
        .apply((ports) => {
          if (!ports || ports.length == 0)
            return {
              service: undefined,
              ingresses: undefined,
              ingressRules: undefined,
            };

          const service = new k8s.core.v1.Service(
            partFullName,
            {
              metadata: {
                namespace: this.namespace,
              },
              spec: {
                selector: matchLabels,
                ports: ports.map((port) => ({
                  name: port.name,
                  protocol: port.protocol ?? "TCP",
                  port: port.servicePort ?? port.containerPort,
                  targetPort: port.containerPort,
                })),
              },
            },
            this.options({ dependsOn: deployment })
          );

          const ingressRules = pulumi
            .all([pulumi.output(app.publicHost), pulumi.output(part.ports)])
            .apply(([publicHost, ports]) =>
              ports
                ? ports
                    .filter((x) => x.ingress)
                    .map<IngressDef>((port) => {
                      const hosts: string[] = [];
                      if (port.ingress?.overrideHost) {
                        hosts.push(...port.ingress.overrideHost);
                      } else {
                        if (publicHost)
                          hosts.push(
                            `${port.ingress?.subDomain ?? name}.${publicHost}`
                          );
                        if (port.ingress?.host)
                          hosts.push(...port.ingress.host);
                      }

                      assert(
                        hosts.length > 0,
                        "no hosts specified for ingress"
                      );

                      return {
                        hosts: hosts,
                        path: port.ingress?.path ?? "/",
                        backend: {
                          serviceName: service.metadata.name,
                          servicePort: port.servicePort ?? port.containerPort,
                          protocol: port.ingress?.protocol ?? "http",
                        },
                      };
                    })
                : []
            );

          const ingresses = ingressRules.apply((rules) => {
            if (rules.length == 0) return undefined;

            return rules.map(
              (rule, idx) =>
                new k8s.networking.v1.Ingress(
                  idx == 0 ? partFullName : `${partFullName}-${idx + 1}`,
                  {
                    metadata: {
                      namespace: this.namespace,
                      annotations: ingressAnnotations({
                        certIssuer: "zerossl",
                        sslRedirect: true,
                        bodySize: "100m",
                        backendGrpc:
                          rule.backend.protocol.toLowerCase() == "grpc",
                        backendHttps:
                          rule.backend.protocol.toLowerCase() == "https" ||
                          rule.backend.servicePort == 443,
                      }),
                    },
                    spec: ingressSpec({
                      host: rule.hosts,
                      tls: {
                        secretName: `${partFullName}-${idx + 1}-tls`,
                      },
                      path: rule.path,
                      backend: {
                        service: {
                          name: rule.backend.serviceName,
                          port: rule.backend.servicePort,
                        },
                      },
                    }),
                  },
                  this.options({ dependsOn: service })
                )
            );
          });

          return { service, ingresses, ingressRules };
        });

      const serviceName = pulumi.output(service).apply((service) => {
        if (!service) {
          return undefined;
        }
        const serviceName = service?.metadata?.name;
        assert(serviceName);
        return serviceName;
      });
      const internalHost = pulumi
        .all([this.namespace, serviceName])
        .apply(([namespace, serviceName]) => {
          return pulumi.interpolate`${serviceName}.${namespace}.svc.cluster.local`;
        });

      deployedParts[partName] = {
        deployment,
        service,
        ingressRules,
        internalHost,
      };
    }

    return {
      namespace: pulumi.output(this.namespace),
      parts: deployedParts,
    };
  }
}

const defaultResources = {
  cpu: "50m/100m",
  memory: "100Mi/500Mi",
};

export interface WebService {
  name: string;
  parts: Record<string, ServiceAppPart>;
  imageName?: pulumi.Input<string>;
  configFiles?: ConfigFile[];
  publicHost?: pulumi.Input<string>;
}

export interface ServiceAppPart {
  ports?: pulumi.Input<pulumi.Input<ServicePort>[]>;
  imageName?: pulumi.Input<string>;
  env?: pulumi.Input<Record<string, pulumi.Input<string>>>;
  resources?: pulumi.Input<ComputeResources | undefined>;
  args?: pulumi.Input<pulumi.Input<string>[]>;
  metrics?: pulumi.Input<Metrics>;
  deployStrategy?: pulumi.Input<DeployStrategy>;
  configFiles?: ConfigFile[];
  pvcs?: pulumi.Input<pulumi.Input<PvcRequest>[]>;
  disabled?: boolean;
  scale?: pulumi.Input<number>;
}

export interface PvcRequest {
  storage: pulumi.Input<Storage>;
  path: string;
}

export interface DeployStrategy {
  type: "Recreate" | "RollingUpdate";
}

export interface ConfigFile {
  path: string;
  content: pulumi.Input<string>;
}

export interface Metrics {
  //port?: pulumi.Input<string>;
  //path?: pulumi.Input<string>;
  labels?: Record<string, pulumi.Input<string>>;
}

export interface ServicePort {
  name: string;
  protocol?: PortProtocol;
  containerPort: number;
  servicePort?: number;
  ingress?: pulumi.Input<Ingress>;
}

export type PortProtocol = "SCTP" | "TCP" | "UDP";

export interface Ingress {
  /*
  Default "/"
   */
  path?: pulumi.Input<string>;

  protocol?: pulumi.Input<string>;
  overrideHost?: pulumi.Input<pulumi.Input<string>[]>;
  host?: pulumi.Input<pulumi.Input<string>[]>;
  subDomain?: pulumi.Input<string>;
}

export interface DeployedServiceApp {
  namespace: pulumi.Output<string>;
  parts: Record<string, DeployedPart>;
}

interface DeployedPart {
  deployment: k8s.apps.v1.Deployment;
  service: pulumi.Output<k8s.core.v1.Service | undefined>;
  internalHost: pulumi.Output<string | undefined>;
  ingressRules: pulumi.Output<IngressDef[] | undefined>;
}

interface IngressDef {
  hosts: string[];
  path: string;
  backend: {
    serviceName: pulumi.Output<string>;
    servicePort: number;
    protocol: string;
  };
}
