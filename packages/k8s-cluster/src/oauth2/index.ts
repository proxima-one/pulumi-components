import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@proxima-one/pulumi-k8s-cluster/src/abstractions';
import {merge} from 'lodash';

export interface OauthInputs {
  namespace?: pulumi.Input<string>;
  ingress?: abstractions.Ingress;
  helmOverride?: abstractions.HelmOverride;

  clientId: string;
  clientSecret: string;
  cookieSecret: string;
  domain: string;
  oauthUrl: string;
}

export interface OauthOutput {
  meta: pulumi.Output<abstractions.HelmMeta>
}

export class Oauth extends pulumi.ComponentResource implements OauthOutput {
  readonly meta: pulumi.Output<abstractions.HelmMeta>

  constructor(name: string, args: OauthInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxyma:Oauth', name, args, opts);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'oauth2-proxy',
      version: args.helmOverride?.version ?? '6.2.0',
      repo: 'https://oauth2-proxy.github.io/manifests',
    })

    const creds = new k8s.core.v1.Secret("oauth2-proxy-creds", {
      metadata: {
        namespace: args.namespace
      },
      stringData: {
        "client-id": args.clientId,
        "client-secret": args.clientSecret,
        "cookie-secret": args.cookieSecret
      }
    }, {parent: this});

    const oauth = new k8s.helm.v3.Release(name, {
      namespace: args.namespace,
      chart: this.meta.chart,
      repositoryOpts: {
        repo: this.meta.repo
      },
      values: merge({}, {
        config: {
          existingSecret: creds.metadata.name
        },
        extraArgs: {
          provider: "github",
          "github-org": "proxima-one",
          "whitelist-domain": `.${args.domain}`,
          "cookie-domain": `.${args.domain}`
        },
        ingress: {
          enabled: true,
          path: "/",
          annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "cert-manager.io/cluster-issuer": "letsencrypt"
          },
          hosts: [args.oauthUrl],
          tls: [
            {
              secretName: `${name}-tls`,
              hosts: [args.oauthUrl]
            }
          ]
        }
      }, args.helmOverride?.values),
    }, {parent: this});
  }
}
