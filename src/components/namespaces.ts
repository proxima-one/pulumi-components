import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as _ from 'lodash';

/**
 * Creates multiple kubernetes namespaces and returns a Record of created underlying
 * k8s namespace resources which is statically typed to user input
 */
export class Namespaces<
  TNamespaces extends string
> extends pulumi.ComponentResource {
  /**
   * Underlying namespaces
   */
  public readonly output: Record<TNamespaces, k8s.core.v1.Namespace>;

  public constructor(
    name: string,
    namespaces: Record<TNamespaces, string>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:Namespaces', name, {}, opts);

    const output: any = {};
    for (const key of _.keys(namespaces)) {
      output[key] = new k8s.core.v1.Namespace(
        namespaces[key as TNamespaces],
        {},
        { parent: this }
      );
    }

    this.output = output;

    this.registerOutputs();
  }
}
