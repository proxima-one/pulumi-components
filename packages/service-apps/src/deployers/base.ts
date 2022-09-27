import * as pulumi from "@pulumi/pulumi";
import { KubernetesServiceDeployer } from "@proxima-one/pulumi-k8s-base";
import { DeployedAppStack } from "@proxima-one/pulumi-k8s-app-stack";

export interface DeployParams {
  org?: string;
  project?: string;
  targetStack?: string;
}

export abstract class AppDeployerBase extends KubernetesServiceDeployer {
  protected readonly stack: string;
  protected readonly cluster: string;
  protected readonly project: string;
  protected readonly env: string;
  protected readonly publicHost: pulumi.Output<string>;
  private readonly appStack: pulumi.Output<pulumi.Unwrap<DeployedAppStack>>;

  public constructor(
    private readonly params: DeployParams,
    private readonly targetAppGroup: string
  ) {
    const stack = params.targetStack ?? pulumi.getStack();
    const project = params.project ?? pulumi.getProject();
    const org = params.org ?? "proxima-one";
    const appStackReference = getStackReference(
      `${org}/${stack}-stack/default`
    );

    const appStack = appStackReference.getOutput("appStack") as pulumi.Output<
      pulumi.Unwrap<DeployedAppStack>
    >;

    const appGroup = appStack.appGroups.apply((x) => {
      const appGroup = x.find((y) => y.name == targetAppGroup);
      if (!appGroup)
        throw new Error(`AppGroup ${targetAppGroup} not found in ${stack}`);
      return appGroup;
    });

    const [cluster, envDraft] = stack.split("-");

    super({
      name: cluster == "amur" ? "infra-k8s" : `${cluster}-k8s`,
      kubeconfig: appStack.kubeconfig,
      namespace: appGroup.namespace,
      imageRegistrySecrets: appStack.imageRegistrySecrets,
      nodeSelectors: appGroup.nodeSelectors,
      storageClasses: appStack.storageClasses?.apply((x) => x ?? []),
    });

    this.appStack = appStack;
    this.env = envDraft ?? "prod";
    this.cluster = cluster;
    this.publicHost = appStack.publicHost;
    this.stack = stack;
    this.project = project;
  }

  protected requireService<T = any>(
    name: string,
    type: string
  ): pulumi.Output<T> {
    return this.appStack.apply((x) => {
      const service = x.services.find((x) => x.name == name && x.type == type);
      if (!service)
        throw new Error(
          `Required service ${name} ${type} not found in ${this.stack}`
        );
      return service.params as T;
    });
  }

  private dump() {
    console.log("STACK: ", this.stack);
    console.log("CLUSTER: ", this.cluster);
    console.log("ENV: ", this.env);
    console.log("PROJECT: ", this.project);
  }
}

function getStackReference(name: string): pulumi.StackReference {
  return stacksPool[name]
    ? stacksPool[name]
    : (stacksPool[name] = new pulumi.StackReference(name));
}

const stacksPool: Record<string, pulumi.StackReference> = {};
