import { Password } from "../components/types";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

export class PasswordResolver {
  private readonly pendingPasswordsLookup: Record<
    string,
    pulumi.Output<string>
  > = {};

  public constructor(private readonly baseResource?: pulumi.Resource) {}

  public resolve(password: Password): pulumi.Output<string> {
    switch (password.type) {
      case "random":
        // cache to allow multiple resolve(name) use
        if (this.pendingPasswordsLookup[password.name])
          return this.pendingPasswordsLookup[password.name];

        const pass = new random.RandomPassword(
          password.name,
          { length: password.length ?? 30, special: false },
          { parent: this.baseResource }
        ).result;
        this.pendingPasswordsLookup[password.name] = pass;
        return pass;
      case "external":
        return pulumi.Output.create<string>(password.password);
    }
  }

  public getResolvedPasswords(): pulumi.Output<Record<string, string>> {
    if (Object.keys(this.pendingPasswordsLookup).length == 0)
      return pulumi.Output.create<Record<string, string>>({});

    // convert to array of output<Tuple(name, pass)>
    const pendingPasswords = Object.entries(this.pendingPasswordsLookup).map(
      (x) => x[1].apply((y) => [x[0], y])
    );
    return pulumi.all(pendingPasswords).apply((pendingPasswords) => {
      const res: Record<string, string> = {};
      for (const [name, pass] of pendingPasswords) res[name] = pass;
      return res;
    });
  }
}
