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

    const infraStack = new pulumi.StackReference(
      `proxima-one/proxima-gke/${node}`,
      {}
    );
    const kubeconfig = infraStack.getOutput("kubeconfig");
    this.k8s = new k8s.Provider("infra-k8s", {
      kubeconfig: kubeconfig,
    });
    const servicesStack = new pulumi.StackReference(
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
