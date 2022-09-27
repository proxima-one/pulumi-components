import * as pulumi from "@pulumi/pulumi";
import * as k8sOps from "@proxima-one/pulumi-k8s-ops";
import * as k8sBase from "@proxima-one/pulumi-k8s-base";
import { AppGroup, DeployedAppStack, DeployedService } from "../interfaces";

export interface DeployParams {
  targetCluster: string;
  org?: string;
  project?: string;
}

export class AppStackDeployer {
  private readonly kubernetesDeployParams: k8sBase.DeployParams;

  protected readonly project: string;
  protected readonly targetCluster: string;
  protected readonly org: string;
  protected readonly ops: pulumi.Output<
    pulumi.Unwrap<k8sOps.DeployedKubernetesOps>
  >;

  public constructor(private readonly params: DeployParams) {
    this.project = params.project ?? pulumi.getProject();
    this.targetCluster = params.targetCluster;
    this.org = params.org ?? "proxima-one";
    const clusterStack = getClusterStackReference(this.targetCluster, this.org);
    const kubeconfig = clusterStack.getOutput("kubeconfig");
    this.ops = clusterStack.getOutput("ops") as pulumi.Output<
      pulumi.Unwrap<k8sOps.DeployedKubernetesOps>
    >;

    this.kubernetesDeployParams = {
      kubeconfig: kubeconfig,
      storageClasses: this.ops.storageClasses,
      name: this.targetCluster,
    };
  }

  public deploy<T extends string>(args: AppStackArgs<T>): AppStack<T> {
    const namespaces = new k8sBase.NamespacesDeployer(
      this.kubernetesDeployParams
    ).deploy({ namespaces: args.namespaces, autoName: false });

    const imageRegistries = args.registries
      ? new k8sBase.ImageRegistryDeployer(this.kubernetesDeployParams).deploy({
          registries: args.registries,
          namespaces: namespaces,
        })
      : { secrets: [] };

    if (args.namespaceMonitors) {
      const monitors = new k8sOps.MonitorDeployer(this.kubernetesDeployParams).deploy({
        name: "ns",
        namespaces: Object.values(args.namespaces),
        targetLabels: args.namespaceMonitors.targetLabels,
      });
    }

    return new AppStack<T>(
      this.kubernetesDeployParams,
      this.ops,
      namespaces,
      imageRegistries.secrets
    );
  }
}

export interface AppStackArgs<T extends string> {
  namespaces: Record<T, string>;
  registries?: pulumi.Input<
    Record<string, pulumi.Input<k8sBase.ImageRegistryInfo | string>>
  >;
  namespaceMonitors?: {
    targetLabels: string[];
  };
}

export class AppStack<TNamespace extends string> {
  private readonly appGroups: AppGroup[] = [];
  private readonly services: DeployedService[] = [];

  public constructor(
    private readonly kubernetesDeployParams: k8sBase.DeployParams,
    private readonly ops: pulumi.Input<
      pulumi.Unwrap<k8sOps.DeployedKubernetesOps>
    >,
    private readonly namespaces: Record<TNamespace, pulumi.Input<string>>,
    private readonly imageRegistrySecrets: pulumi.Input<
      k8sBase.ImageRegistrySecret[]
    >
  ) {}

  public deployService(
    target: {
      namespace: TNamespace;
      nodeSelectors?: pulumi.Input<Record<string, string>>;
    },
    func: (params: k8sBase.ServiceDeployParameters) => DeployedService
  ) {
    const params = {
      ...this.kubernetesDeployParams,
      namespace: this.namespaces[target.namespace],
      nodeSelectors: target.nodeSelectors,
      imageRegistrySecrets: this.imageRegistrySecrets,
    };

    this.services.push(func(params));
  }

  public service(name: string, type: string, params: pulumi.Input<any>) {
    this.services.push({name, type, params});
  }

  public appGroup(
    name: string,
    namespace: TNamespace,
    nodeSelectors?: Record<string, string>
  ) {
    this.appGroups.push({
      name,
      namespace,
      nodeSelectors: nodeSelectors ?? {},
    });
  }

  public output(): pulumi.Output<DeployedAppStack> {
    return pulumi.output({
      kubeconfig: this.kubernetesDeployParams.kubeconfig,
      appGroups: this.appGroups,
      services: this.services,
      imageRegistrySecrets: this.imageRegistrySecrets,
    });
  }
}

function getClusterStackReference(
  cluster: string,
  org: string
): pulumi.StackReference {
  const stackName = `${org}/${cluster}-cluster/default`;
  return stacksPool[stackName]
    ? stacksPool[stackName]
    : (stacksPool[stackName] = new pulumi.StackReference(stackName));
}

const stacksPool: Record<string, pulumi.StackReference> = {};
