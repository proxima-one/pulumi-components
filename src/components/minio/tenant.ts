import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";
import * as certManager from "../cert-manager";
import { NewStorageClaim, Password, Resources } from "../types";

/**
 * Installs minio/tenant helm chart
 */
export class MinioTenant extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create the operator
   */
  public readonly chart: k8s.helm.v3.Chart;

  /**
   * If publicHost is given - certificate will be created via cert-manager
   */
  public readonly certificate?: k8s.apiextensions.CustomResource;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly connectionDetails: pulumi.Output<MinioConnectionDetails>;

  public readonly publicConsoleEndpoint?: string;
  public readonly publicApiEndpoint?: string;

  public constructor(
    name: string,
    args: MinioTenantArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MinioTenant", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);

    const ingressValues: any = {
      enabled: false,
    };

    const auth: MinioTenantArgs["auth"] = args.auth ?? {
      accessKey: `${name}-key`,
      secretKey: {
        type: "random",
        name: `${name}-secret`,
      },
    };

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: "https://operator.min.io/",
        },
        chart: "tenant",
        version: "4.4.2",
        namespace: args.namespace.metadata.name,
        values: {
          tenants: [
            {
              name: name,
              namespace: args.namespace.metadata.name,
              pools: args.pools.map((p, ind) => {
                if (p.volumesPerServer < 4)
                  throw new Error(
                    `Pool #${ind} must have a minimum 4 volumes per server`
                  );
                return {
                  servers: p.servers,
                  volumesPerServer: p.volumesPerServer,
                  size: p.storage.size,
                  storageClassName: p.storage.class,
                  resources: p.resources ?? {
                    requests: {
                      memory: "250Mi",
                      cpu: "50m",
                    },
                    limits: {
                      memory: "1000Mi",
                      cpu: "500m",
                    },
                  },
                };
              }),
              secrets: {
                enabled: true,
                name: `${name}-secret`,
                accessKey: auth.accessKey,
                secretKey: passwords.resolve(auth.secretKey),
              },
            },
          ],
        },
      },
      { parent: this }
    );

    const tenantResourceName = pulumi.concat(
      "minio.min.io/v2/Tenant::",
      args.namespace.metadata.name,
      "/",
      name
    );

    if (args.console?.publicHost) {
      const cert = new certManager.Certificate(
        `${name}-console-cert`,
        {
          domain: args.console.publicHost,
          namespace: args.namespace,
        },
        { parent: this }
      );

      const ingress = new k8s.networking.v1.Ingress(
        `${name}-console-ingress`,
        {
          metadata: {
            namespace: args.namespace.metadata.name,
            annotations: helpers.ingressAnnotations({}),
          },
          spec: helpers.ingressSpec({
            host: args.console.publicHost,
            path: args.console.path ?? "/",
            backend: {
              service: {
                name: `${name}-console`,
                port: 9090,
              },
            },
            tls: { secretName: cert.secretName },
          }),
        },
        { parent: this }
      );

      this.publicConsoleEndpoint = `https://${args.console.publicHost}`;
    }

    if (args.api?.publicHost) {
      const cert = new certManager.Certificate(
        `${name}-api-cert`,
        {
          domain: args.api.publicHost,
          namespace: args.namespace,
        },
        { parent: this }
      );

      const ingress = new k8s.networking.v1.Ingress(
        `${name}-api-ingress`,
        {
          metadata: {
            namespace: args.namespace.metadata.name,
            annotations: helpers.ingressAnnotations({
              bodySize: "1000m",
            }),
          },
          spec: helpers.ingressSpec({
            host: args.api.publicHost,
            path: args.api.path ?? "/",
            backend: {
              service: {
                name: "minio",
                port: 80,
              },
            },
            tls: { secretName: cert.secretName },
          }),
        },
        { parent: this }
      );

      this.publicApiEndpoint = `https://${args.api.publicHost}`;
    }

    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.connectionDetails = pulumi
      .all([args.namespace.metadata.name, passwords.resolve(auth.secretKey)])
      .apply(([ns, secret]) => {
        return {
          endpoint: `http://minio.${ns}.svc.cluster.local`,
          accessKey: auth.accessKey,
          secretKey: secret,
        };
      });

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
      connectionDetails: this.connectionDetails,
    });
  }
}

export interface MinioTenantArgs {
  namespace: k8s.core.v1.Namespace;
  pools: {
    servers: number;
    volumesPerServer: number;
    storage: NewStorageClaim;
    resources?: Resources;
  }[];
  auth?: {
    accessKey: string;
    secretKey: Password;
  };

  console?: {
    publicHost?: string;
    path?: string;
  };

  api?: {
    publicHost?: string;
    path?: string;
  };
}

export interface MinioConnectionDetails {
  endpoint: string;
  accessKey: string;
  secretKey: string;
}
