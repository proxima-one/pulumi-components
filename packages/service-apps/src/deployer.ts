import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { input as inputs } from "@pulumi/kubernetes/types";
import { ingressAnnotations, ingressSpec } from "./ingress";

export interface DeploymentParameters {
  project?: string;
  targetStack?: string;
}

/*
  Responsible for deployment of any proxima service app.
 */
export class ServiceAppDeployer {
  public constructor(private readonly params: DeploymentParameters) {}

  public deploy(app: ServiceApp): DeployedServiceApp {
    const targetStack = this.params.targetStack ?? pulumi.getStack();
    const project = this.params.project ?? pulumi.getProject();

    const [node, envDraft] = targetStack.split("-");
    const env = envDraft ?? "prod";

    console.log("STACK: ", targetStack);
    console.log("NODE: ", node);
    console.log("ENV: ", env);
    console.log("PROJECT: ", project);

    const infraStack = new pulumi.StackReference(
      `proxima-one/proxima-gke/${node}`,
      {}
    );
    const kubeconfig = infraStack.getOutput("kubeconfig");
    const k8sProvider = new k8s.Provider("infra-k8s", {
      kubeconfig: kubeconfig,
    });
    const servicesStack = new pulumi.StackReference(
      `proxima-one/${targetStack}-services/default`
    );
    const deployOptions = servicesStack.requireOutput(
      "periphery"
    ) as pulumi.Output<DeploymentOptions>;
    const publicHost = servicesStack.requireOutput(
      "publicHost"
    ) as pulumi.Output<string>;

    for (const [partName, part] of Object.entries(app.parts)) {
      const imageName = pulumi
        .all([pulumi.output(app.imageName), pulumi.output(part.imageName)])
        .apply(([appImage, partImage]) => {
          const imageName = partImage ?? appImage;
          if (!imageName)
            throw new Error(`unspecified image for part ${partName}`);
          return imageName;
        });

      const name = partName == "" ? project : `${project}-${partName}`;

      const metricsLabels = pulumi.output(part.metrics).apply((x) =>
        x
          ? {
              monitoring: "",
              ...x.labels,
            }
          : {}
      );

      const matchLabels: Record<string, pulumi.Input<string>> = {
        app: name,
      };

      const deployment = new k8s.apps.v1.Deployment(
        name,
        {
          metadata: {
            namespace: deployOptions.services.namespace,
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
                    name: deployOptions.services.imagePullSecret,
                  },
                ],
                containers: [
                  {
                    image: imageName,
                    name: name,
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
                        parseResourceRequirements(x ?? defaultResources)
                      ),
                  },
                ],
              },
            },
          },
        },
        { provider: k8sProvider }
      );

      pulumi.output(part.ports).apply((ports) => {
        if (!ports || ports.length == 0) return undefined;

        const service = new k8s.core.v1.Service(
          name,
          {
            metadata: {
              namespace: deployOptions.services.namespace,
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
          { dependsOn: deployment, provider: k8sProvider }
        );

        const ingressRules = pulumi
          .all([publicHost, pulumi.output(part.ports)])
          .apply(([publicHost, ports]) =>
            ports
              ? ports
                  .filter((x) => x.ingress)
                  .map<IngressDef>((port) => {
                    const hosts: string[] = [];
                    if (port.ingress?.overrideHost) {
                      hosts.push(...port.ingress.overrideHost);
                    } else {
                      hosts.push(`${project}.${publicHost}`);
                      if (port.ingress?.host) hosts.push(...port.ingress.host);
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
            (rule) =>
              new k8s.networking.v1.Ingress(
                project,
                {
                  metadata: {
                    namespace: deployOptions.services.namespace,
                    annotations: ingressAnnotations({
                      certIssuer: "letsencrypt",
                      sslRedirect: true,
                      bodySize: "100m",
                      hsts: rule.backend.protocol.toLowerCase() == "grpc",
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
                      secretName: `${name}-http-tls`,
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
                { dependsOn: service, provider: k8sProvider }
              )
          );
        });
      });
    }

    return {};
  }
}

const defaultResources = {
  cpu: "50m/100m",
  memory: "100Mi/500Mi",
};

export type ComputeResources =
  | {
      cpu: string;
      memory: string;
    }
  | string;

export interface ServiceApp {
  parts: Record<string, ServiceAppPart>;
  imageName?: pulumi.Input<string>;
}

export interface ServiceAppPart {
  ports?: pulumi.Input<pulumi.Input<ServicePort>[]>;
  imageName?: pulumi.Input<string>;
  env?: pulumi.Input<Record<string, pulumi.Input<string>>>;
  resources?: pulumi.Input<ComputeResources>;
  args?: pulumi.Input<pulumi.Input<string>[]>;
  metrics?: pulumi.Input<Metrics>;
}

export interface Metrics {
  port?: pulumi.Input<string>;
  path?: pulumi.Input<string>;
  labels?: Record<string, pulumi.Input<string>>;
}

export interface ServicePort {
  name: string;

  /*
  Default "TCP"
   */
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
}

export interface DeployedServiceApp {}

interface DeploymentOptions {
  services: {
    namespace: string;
    imagePullSecret: string;
  };
  storage: {
    namespace: string;
  };
  cloudMongoDb: {
    uri: string;
  };
  nodeSelectors: {
    indexingService: Record<string, string>;
    storage: Record<string, string>;
    webService: Record<string, string>;
  };
}

function parseResourceRequirements(
  req: ComputeResources
): inputs.core.v1.ResourceRequirements {
  const [cpu, memory] =
    typeof req == "string" ? req.split(",") : [req.cpu, req.memory];

  return {
    requests: {
      cpu: cpu.split("/")[0],
      memory: memory.split("/")[0],
    },
    limits: {
      cpu: cpu.split("/")[1],
      memory: memory.split("/")[1],
    },
  };
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
