/*
  Responsible for deployment of any proxima service app.
 */
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as _ from "lodash";
import {
  ingressAnnotations,
  ingressSpec,
} from "@proxima-one/pulumi-proxima-node";
import { AppDeployerBase, ComputeResources } from "./base";

export class WebServiceDeployer extends AppDeployerBase {
  protected get namespace(): pulumi.Output<string> {
    return this.deployOptions.services.namespace;
  }

  protected get imagePullSecret(): pulumi.Output<string> {
    return this.deployOptions.services.imagePullSecret;
  }

  protected get nodeSelector() {
    return this.deployOptions.nodeSelectors.webService;
  }

  public deploy(app: WebService): DeployedServiceApp {
    const name = app.name ?? this.project;
    const deployedParts: Record<string, DeployedPart> = {};

    for (const [partName, part] of _.entries(app.parts)) {
      if (part.disabled) continue;

      const imageName = pulumi
        .all([pulumi.output(app.imageName), pulumi.output(part.imageName)])
        .apply(([appImage, partImage]) => {
          const imageName = partImage ?? appImage;
          if (!imageName)
            throw new Error(`unspecified image for part ${partName}`);
          return imageName;
        });

      const partFullName = partName == "" ? name : `${name}-${partName}`;

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

      const configMaps: k8s.core.v1.ConfigMap[] | undefined = part.configs?.map(config => {
        return new k8s.core.v1.ConfigMap(
          partFullName + config.mountPath.split("/")[config.mountPath.split("/").length - 1], // partFullName + filename
          {
            metadata: {
              namespace: this.namespace,
            },
            data: config.files,
          },
          {provider: this.k8s}
        )
      })

      const deployment = new k8s.apps.v1.Deployment(
        partFullName,
        {
          metadata: {
            namespace: this.namespace,
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: matchLabels,
            },
            template: {
              metadata: {
                labels: metricsLabels.apply((x) => ({ ...x, ...matchLabels })),
              },
              spec: {
                restartPolicy: "Always",
                imagePullSecrets: [
                  {
                    name: this.imagePullSecret,
                  },
                ],
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
                        this.parseResourceRequirements(x ?? defaultResources)
                      ),
                    volumeMounts: part.configs?.map((configFolder, i) => { return {
                      mountPath: configFolder.mountPath,
                      name: "config-" + i.toString()
                    }})
                  },
                ],
                volumes: configMaps?.map((configMap, i) => { return {
                  name: "config-" + i.toString(),
                  configMap: {
                    name: configMap.id.apply(s => s.split("/")[s.split("/").length - 1])
                  }
                }})
              },
            },
          },
        },
        { provider: this.k8s }
      );

      const { service, ingresses } = pulumi
        .output(part.ports)
        .apply((ports) => {
          if (!ports || ports.length == 0)
            return { service: undefined, ingresses: undefined };

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
            { dependsOn: deployment, provider: this.k8s }
          );

          const ingressRules = pulumi
            .all([this.publicHost, pulumi.output(part.ports)])
            .apply(([publicHost, ports]) =>
              ports
                ? ports
                    .filter((x) => x.ingress)
                    .map<IngressDef>((port) => {
                      const hosts: string[] = [];
                      if (port.ingress?.overrideHost) {
                        hosts.push(...port.ingress.overrideHost);
                      } else {
                        hosts.push(
                          `${port.ingress?.subDomain ?? name}.${publicHost}`
                        );
                        if (port.ingress?.host)
                          hosts.push(...port.ingress.host);
                      }

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
                      namespace: this.deployOptions.services.namespace,
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
                  { dependsOn: service, provider: this.k8s }
                )
            );
          });

          return { service: service, ingresses: ingresses };
        });

      deployedParts[partName] = {
        deployment: deployment,
        service: service,
      };
    }

    return {
      parts: deployedParts,
    };
  }
}

const defaultResources = {
  cpu: "50m/100m",
  memory: "100Mi/500Mi",
};

export interface WebService {
  name?: string;
  parts: Record<string, ServiceAppPart>;
  imageName?: pulumi.Input<string>;
}

export interface ServiceAppPart {
  ports?: pulumi.Input<pulumi.Input<ServicePort>[]>;
  imageName?: pulumi.Input<string>;
  env?: pulumi.Input<Record<string, pulumi.Input<string>>>;
  resources?: pulumi.Input<ComputeResources | undefined>;
  args?: pulumi.Input<pulumi.Input<string>[]>;
  metrics?: pulumi.Input<Metrics>;
  disabled?: boolean;
  configs?: ConfigFolder[];
}

interface ConfigFolder {
  mountPath: string;
  files: Record<string, string>;  // fileName: content
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
  parts: Record<string, DeployedPart>;
}

interface DeployedPart {
  deployment: k8s.apps.v1.Deployment;
  service: pulumi.Output<k8s.core.v1.Service | undefined>;
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
