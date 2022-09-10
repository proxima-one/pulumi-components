import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class KafkaOperator extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create the operator
   */
  public readonly chart: k8s.helm.v3.Release;

  public constructor(
    name: string,
    args: KafkaOperatorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:KafkaOperator", name, args, opts);

    const values = pulumi.Output.create(args.watchNamespaces).apply(
      (namespaces) => {
        return {
          watchNamespaces: namespaces,
          watchAnyNamespace: args.watchAnyNamespace,
          nodeSelector: args.nodeSelector,
        };
      }
    );

    this.chart = new k8s.helm.v3.Release(
      name,
      {
        repositoryOpts: {
          repo: "https://strimzi.io/charts",
        },
        chart: "strimzi-kafka-operator",
        version: "0.27.0",
        namespace: args.namespace,
        values: values,
      },
      { parent: this }
    );

    this.registerOutputs();
  }
}

export interface KafkaOperatorArgs {
  namespace: pulumi.Input<string>;
  watchNamespaces: pulumi.Input<string[]>;
  nodeSelector?: pulumi.Input<Record<string, string>>;
  watchAnyNamespace: boolean;
}
