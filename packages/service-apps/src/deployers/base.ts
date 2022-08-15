import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface DeploymentParameters {
  project?: string;
  targetStack?: string;
}

export abstract class AppDeployerBase {
  protected readonly stack: string;
  protected readonly project: string;
  protected readonly env: string;
  protected readonly k8s: k8s.Provider;
  protected readonly deployOptions: pulumi.Output<DeploymentOptions>;
  protected readonly publicHost: pulumi.Output<string>;
  protected readonly node: string;

  public constructor(private readonly params: DeploymentParameters) {
    this.stack = this.params.targetStack ?? pulumi.getStack();
    this.project = this.params.project ?? pulumi.getProject();

    const [node, envDraft] = this.stack.split("-");
    this.env = envDraft ?? "prod";
    this.node = node;

    // note, infra-k8s for backwards compatibility
    this.k8s = getKubernetesProvider(
      node,
      node == "amur" ? "infra-k8s" : `${node}-k8s`
    );

    const servicesStack = getStackReference(
      `proxima-one/${this.stack}-services/default`
    );
    this.deployOptions = servicesStack.requireOutput(
      "periphery"
    ) as pulumi.Output<DeploymentOptions>;

    this.publicHost = servicesStack.requireOutput(
      "publicHost"
    ) as pulumi.Output<string>;
  }

  protected dump() {
    console.log("STACK: ", this.stack);
    console.log("NODE: ", this.node);
    console.log("ENV: ", this.env);
    console.log("PROJECT: ", this.project);
  }

  protected parseResourceRequirements(
    req: ComputeResources
  ): ResourceRequirements {
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
}

function getKubernetesProvider(
  node: string,
  providerName: string
): k8s.Provider {
  if (k8sProviders[node]) return k8sProviders[node];

  const infraStack = getStackReference(`proxima-one/proxima-gke/${node}`);
  const kubeconfig = infraStack.getOutput("kubeconfig");

  return (k8sProviders[node] = new k8s.Provider(providerName, {
    kubeconfig: kubeconfig,
  }));
}

const k8sProviders: Record<string, k8s.Provider> = {};

function getStackReference(name: string): pulumi.StackReference {
  return stacksPool[name]
    ? stacksPool[name]
    : (stacksPool[name] = new pulumi.StackReference(name));
}

const stacksPool: Record<string, pulumi.StackReference> = {};

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

export type ComputeResources =
  | {
      cpu: string;
      memory: string;
    }
  | string;

interface ResourceRequirements {
  requests: ResourceMetrics;
  limits: ResourceMetrics;
}

interface ResourceMetrics extends Record<string, string> {
  memory: string;
  cpu: string;
}
