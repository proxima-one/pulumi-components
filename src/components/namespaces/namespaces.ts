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
    args: NamespacesArgs<TNamespaces>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:Namespaces', name, {}, opts);

    const output: any = {};
    for (const key of _.keys(args.namespaces)) {
      const metadata: any = {};
      if (!args.autoName) metadata.name = args.namespaces[key as TNamespaces]; // TODO: doesn't work!
      output[key] = new k8s.core.v1.Namespace(
        args.namespaces[key as TNamespaces],
        {
          metadata: metadata,
        },
        { parent: this }
      );
    }

    this.output = output;

    this.registerOutputs();
  }
}

export interface NamespacesArgs<TNamespaces extends string> {
  namespaces: Record<TNamespaces, string>;
  autoName?: boolean;
}
