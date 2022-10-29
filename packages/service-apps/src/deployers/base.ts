import * as pulumi from "@pulumi/pulumi";
import { ServiceDeployParameters } from "@proxima-one/pulumi-k8s-base";
import { DeployedAppStack } from "@proxima-one/pulumi-k8s-app-stack";

export interface DeployParams {
  org?: string;
  project?: string;
  targetStack?: string;
}

export abstract class AppDeployerBase {
  protected readonly stack: string;
  protected readonly cluster: string;
  protected readonly project: string;
  protected readonly env: string;
  protected readonly publicHost: pulumi.Output<string>;
  private readonly appStack: pulumi.Output<pulumi.Unwrap<DeployedAppStack>>;

  public constructor(private readonly params: DeployParams) {
    const stack = this.params.targetStack ?? pulumi.getStack();
    const project = this.params.project ?? pulumi.getProject();
    const org = this.params.org ?? "proxima-one";
    const appStackReference = getStackReference(
      `${org}/${stack}-stack/default`
    );
    const [cluster, envDraft] = stack.split("-");
    const appStack = appStackReference.getOutput("appStack") as pulumi.Output<
      pulumi.Unwrap<DeployedAppStack>
    >;

    this.appStack = appStack;
    this.env = envDraft ?? "prod";
    this.cluster = cluster;
    this.publicHost = appStack.publicHost;
    this.stack = stack;
    this.project = project;
  }

  protected getDeployParams(targetAppGroup: string): ServiceDeployParameters {
    const appGroup = this.appStack.appGroups.apply((x) => {
      const appGroup = x.find((y) => y.name == targetAppGroup);
      if (!appGroup)
        throw new Error(
          `AppGroup ${targetAppGroup} not found in ${this.stack}`
        );
      return appGroup;
    });

    return {
      name: this.cluster == "amur" ? "infra-k8s" : `${this.cluster}-k8s`,
      kubeconfig: this.appStack.kubeconfig,
      namespace: appGroup.namespace,
      imageRegistrySecrets: this.appStack.imageRegistrySecrets,
      nodeSelectors: appGroup.nodeSelectors,
      storageClasses: this.appStack.storageClasses?.apply((x) => x ?? []),
    };
  }

  protected findService<T = any>(
    name: string,
    type: string
  ): pulumi.Output<T | undefined> {
    return this.appStack.apply((x) => {
      const service = x.services.find((x) => x.name == name && x.type == type);
      return service?.params as T;
    });
  }

  protected findAnyService<T = any>(
    names: string[],
    type: string
  ): pulumi.Output<T | undefined> {
    return this.appStack.apply((x) => {
      const service = x.services.find((x) => names.includes(x.name) && x.type == type);
      return service?.params as T;
    });
  }

  protected requireService<T = any>(
    name: string,
    type: string
  ): pulumi.Output<T> {
    return this.findService<T>(name, type).apply((x) => {
      if (!x)
        throw new Error(
          `Required service ${name} ${type} not found in ${this.stack}`
        );
      return x;
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
