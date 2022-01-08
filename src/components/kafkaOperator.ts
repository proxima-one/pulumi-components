import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class KafkaOperator extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create the operator
   */
  public readonly chart: k8s.helm.v3.Chart;

  public constructor(
    name: string,
    args: KafkaOperatorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:KafkaOperator', name, args, opts);

    const values = pulumi
      .all(args.watchNamespaces.map((x) => x.metadata))
      .apply((metadatas) => {
        return {
          watchNamespaces: metadatas.map((x) => x.name),
          watchAnyNamespace: args.watchAnyNamespace,
        };
      });

    this.chart = new k8s.helm.v3.Chart(
      'kafka-operator',
      {
        fetchOpts: {
          repo: 'https://strimzi.io/charts',
        },
        chart: 'strimzi-kafka-operator',
        version: '0.27.0',
        namespace: args.namespace.metadata.name,
        values: values,
      },
      { parent: this }
    );

    this.registerOutputs();
  }
}

export interface KafkaOperatorArgs {
  namespace: k8s.core.v1.Namespace;
  watchNamespaces: k8s.core.v1.Namespace[];
  watchAnyNamespace: boolean;
}
