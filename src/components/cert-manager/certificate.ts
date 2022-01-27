import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Creates cert-manager Certificate resource
 */
export class Certificate extends pulumi.ComponentResource {
  /**
   * Underlying cert-manager Certificate resource
   */
  public readonly certificate: k8s.apiextensions.CustomResource;

  public readonly secretName: pulumi.Output<string>;

  public constructor(
    name: string,
    args: CertificateArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:Certificate", name, {}, opts);

    const certSecretName = `${name}-tls`;
    this.certificate = new k8s.apiextensions.CustomResource(
      name,
      {
        apiVersion: "certmanager.k8s.io/v1alpha1",
        kind: "Certificate",
        metadata: {
          namespace: args.namespace.metadata.name,
        },
        spec: {
          secretName: certSecretName,
          issuerRef: {
            kind: "ClusterIssuer",
            name: "letsencrypt",
          },
          commonName: args.domain,
          dnsNames: [args.domain],
          acme: {
            config: [
              {
                http01: { ingressClass: "nginx" },
                domains: [args.domain],
              },
            ],
          },
        },
      },
      {
        parent: this,
      }
    );

    this.secretName = pulumi.Output.create<string>(certSecretName);

    this.registerOutputs({
      secretName: this.secretName,
    });
  }
}

export interface CertificateArgs {
  namespace: k8s.core.v1.Namespace;
  domain: string;
}
