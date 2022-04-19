import { optionsToArgs } from "./options";

describe("optionsToArgs", () => {
  it("it should convert options to args", () => {
    const actual = optionsToArgs({
      syncMode: "snap",
      network: "mainnet",
      txLookupLimit: 0,
      networking: {
        maxpeers: 100,
      },
      cache: {
        memory: 4096,
      },
      api: {
        http: {
          address: "0.0.0.0",
          corsDomain: "",
          port: 8545,
          api: ["eth", "net", "web3", "personal"],
        },
        ws: {
          port: 8546,
          address: "0.0.0.0",
          origins: ["*"],
          api: ["eth", "net", "web3", "personal"],
        },
      },
    });

    console.log(actual);
  });
});
