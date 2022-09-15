import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { HelmMeta, HelmOverride } from "../../interfaces";
import { merge } from "lodash";

export interface OAuthArgs {
  namespace?: pulumi.Input<string>;
  helmOverride?: HelmOverride;
  provider: OAuthProvider;
  domain: pulumi.Input<string>;
  emailDomains: pulumi.Input<string[]>;
  ingress: {
    host: pulumi.Input<string>;
    certificateIssuer: string;
  };
}

export type OAuthProvider = GithubProvider;

export interface GithubProvider {
  type: "github";
  org: string;
  clientId: pulumi.Input<string>;
  clientSecret: pulumi.Input<string>;
  cookieSecret: pulumi.Input<string>;
}

export class Oauth extends pulumi.ComponentResource {
  public readonly publicHost: pulumi.Output<string>;

  constructor(
    name: string,
    args: OAuthArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima:Oauth", name, args, opts);

    const meta = pulumi.output<HelmMeta>({
      chart: "oauth2-proxy",
      version: args.helmOverride?.version ?? "6.2.7",
      repo: "https://oauth2-proxy.github.io/manifests",
    });

    const creds = new k8s.core.v1.Secret(
      "oauth2-proxy-creds",
      {
        metadata: {
          namespace: args.namespace,
        },
        stringData: {
          "client-id": args.provider.clientId,
          "client-secret": args.provider.clientSecret,
          "cookie-secret": args.provider.cookieSecret,
        },
      },
      { parent: this }
    );

    this.publicHost = pulumi.output(args.ingress.host);
    const oauth = new k8s.helm.v3.Release(
      name,
      {
        namespace: args.namespace,
        chart: meta.chart,
        repositoryOpts: {
          repo: meta.repo,
        },
        values: merge(
          {},
          {
            config: {
              existingSecret: creds.metadata.name,
              configFile: pulumi
                .all([
                  pulumi.interpolate`email_domains = ${toGolangConfigList(
                    args.emailDomains
                  )}`,
                  pulumi.interpolate`upstreams = ${toGolangConfigList([
                    "file:///dev/null",
                  ])}`,
                ])
                .apply((x) => x.join("\n")),
            },
            extraArgs: {
              provider: args.provider.type,
              "github-org": args.provider.org,
              "whitelist-domain": `.${args.domain}`,
              "cookie-domain": `.${args.domain}`,
              scope: "user:email",
            },
            ingress: {
              enabled: true,
              path: "/",
              annotations: {
                "kubernetes.io/ingress.class": "nginx",
                "cert-manager.io/cluster-issuer":
                  args.ingress.certificateIssuer,
              },
              hosts: [args.ingress.host],
              tls: [
                {
                  secretName: `${name}-tls`,
                  hosts: [args.ingress.host],
                },
              ],
            },
          },
          args.helmOverride?.values
        ),
      },
      { parent: this }
    );
  }
}

function toGolangConfigList(
  list: pulumi.Input<string[]>
): pulumi.Output<string> {
  return pulumi
    .output(list)
    .apply((x) => x.map((x) => `"${x}"`).join(","))
    .apply((x) => `[${x}]`);
}
