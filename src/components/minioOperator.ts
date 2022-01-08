import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/**
 * Installs minio/operator helm chart
 */
export class MinIOOperator extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create the operator
   */
  public readonly chart: k8s.helm.v3.Chart;

  /**
   * If publicHost is given - certificate will be created via cert-manager
   */
  public readonly certificate?: k8s.apiextensions.CustomResource;

  public readonly publicHost?: string;

  public constructor(
    name: string,
    args: MinIOOperatorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:MinIOOperator', name, args, opts);


    const ingressValues: any = {
      enabled: false
    };

    if (args.console?.publicHost) {
      this.publicHost = args.console.publicHost;
      const certSecretName = `${name}-tls`;
      this.certificate = new k8s.apiextensions.CustomResource(`${name}-certificate`, {
        apiVersion: "certmanager.k8s.io/v1alpha1",
        kind: "Certificate",
        metadata: {
          namespace: args.namespace.metadata.name,
        },
        spec: {
          secretName: certSecretName,
          issuerRef: {
            kind: "ClusterIssuer",
            name: "letsencrypt"
          },
          commonName: args.console.publicHost,
          dnsNames: [args.console.publicHost],
          acme: {
            config: [{
              http01: { ingressClass: "nginx" },
              domains: [args.console.publicHost]
            }]
          }
        }
      }, {
        parent: this
      });

      ingressValues.enabled = true;
      ingressValues.ingressClassName = "nginx";
      ingressValues.tls = [{
        hots: [args.console.publicHost],
        secretName: certSecretName
      }];
      ingressValues.host = args.console.publicHost;
      ingressValues.path = args.console.path || "/";
    }

    pulumi.log.info(`Ingress Values ${JSON.stringify(ingressValues)}`);

    this.chart = new k8s.helm.v3.Chart(
      'minio-operator',
      {
        fetchOpts: {
          repo: 'https://operator.min.io/',
        },
        chart: 'operator',
        version: '4.4.2',
        namespace: args.namespace.metadata.name,
        values: {
          console: {
            ingress: ingressValues
          }
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
