import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as certManager from "../cert-manager";

/**
 * Installs minio/operator helm chart
 */
export class MinioOperator extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create the operator
   */
  public readonly chart: k8s.helm.v3.Chart;

  /**
   * If publicHost is given - certificate will be created via cert-manager
   */
  public readonly certificate?: certManager.Certificate;

  public readonly publicHost?: string;

  public constructor(
    name: string,
    args: MinIOOperatorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MinioOperator", name, args, opts);

    const ingressValues: any = {
      enabled: false,
    };

    if (args.console?.publicHost) {
      this.publicHost = args.console.publicHost;

      const certificate = new certManager.Certificate(
        `${name}-cert`,
        { namespace: args.namespace, domain: args.console.publicHost },
        { parent: this }
      );

      ingressValues.enabled = true;
      ingressValues.ingressClassName = "nginx";
      ingressValues.tls = [
        {
          hots: [args.console.publicHost],
          secretName: certificate.secretName,
        },
      ];
      ingressValues.host = args.console.publicHost;
      ingressValues.path = args.console.path || "/";

      this.certificate = certificate;
    }

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: "https://operator.min.io/",
        },
        chart: "operator",
        version: "4.4.2",
        namespace: args.namespace.metadata.name,
        values: {
          console: {
            ingress: ingressValues,
          },
        },
      },
      { parent: this }
    );

    this.registerOutputs();
  }
}

export interface MinIOOperatorArgs {
  namespace: k8s.core.v1.Namespace;
  console?: {
    publicHost?: string;
    path?: string;
  };
}
