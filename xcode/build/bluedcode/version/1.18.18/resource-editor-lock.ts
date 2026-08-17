export type LockedResourceEditorFile = {
  file: string
  size: number
  sha256: string
}

export type LockedResourceEditorPackage = {
  name: string
  version: string
  entry: string
  treeSha256: string
  files: readonly LockedResourceEditorFile[]
}

const reseditFiles = [
  {
    file: "dist/data/IconFile.js",
    size: 5525,
    sha256: "630a8abca7f84a7b34a028a4011eb56d983d019d1b2b4aafb1de961d4578c768",
  },
  {
    file: "dist/data/IconItem.js",
    size: 6951,
    sha256: "c5195e6e4079ff5543a51e172bfd66e20c82d11331af2d3310fcba915749fa5d",
  },
  {
    file: "dist/data/RawIconItem.js",
    size: 1179,
    sha256: "85053988be4813bf8599304bf479a5031c0e1abba9e92187ce6081765f885767",
  },
  { file: "dist/data/index.js", size: 430, sha256: "12f5a556d5161b2d4effcf2bb66c82d9ac4c837f553275f447445ed1a0c8c8bb" },
  { file: "dist/index.js", size: 1101, sha256: "a92b2ac81a45feaf3abbed1ee38a87d737c0272e87281b4e0318c78268332c16" },
  { file: "dist/index.mjs", size: 344, sha256: "b493ff6f14840d6e46b60b7f6e2e1f505531683c412c9bcc151b6bbf8963df77" },
  {
    file: "dist/resource/IconGroupEntry.js",
    size: 11192,
    sha256: "e66725ca1d73e2791ddeb853ba66322543cd98f1a0f26c574b1b9949828257d8",
  },
  {
    file: "dist/resource/StringTable.js",
    size: 4954,
    sha256: "b640d7993c7c061f0843110f3bbf360b769ecd2ecc330d9bc408ba8adc7ccd94",
  },
  {
    file: "dist/resource/StringTableItem.js",
    size: 2586,
    sha256: "fac8040d5d1913061da31ab3adcb3a18de19546be357f6f853653c3b0d55e356",
  },
  {
    file: "dist/resource/VersionFileFlags.js",
    size: 787,
    sha256: "a14cd2c0160ec6536537e7f72f625ff914a5dbc6d9cd1d51c457a8fa0c4206a3",
  },
  {
    file: "dist/resource/VersionFileOS.js",
    size: 1210,
    sha256: "0e657c4ebb2159b5c057e684e09c83c98c092dfaa70a9b0e3019e8a9eb46d624",
  },
  {
    file: "dist/resource/VersionFileSubtypes.js",
    size: 1848,
    sha256: "83cb17c8b050c819d7cf451c6e1116cbf089ea44040d1d656b130e6c9c64e368",
  },
  {
    file: "dist/resource/VersionFileType.js",
    size: 727,
    sha256: "90a7c679b98c139115a4c37984ee1c1343059fb8cc96730cdfb9134761d530de",
  },
  {
    file: "dist/resource/VersionInfo.js",
    size: 30716,
    sha256: "81517e2d6479e124c34d2c4284d160f36cf70055ed9db6a1226313452d90e8a9",
  },
  {
    file: "dist/resource/index.js",
    size: 1361,
    sha256: "77dc860cb53a02b0467291b48482d690133f15c7c31de139842f760558ff36ab",
  },
  {
    file: "dist/sign/certUtil.js",
    size: 10357,
    sha256: "b7726d40864f28b6b5ebb77ce8d1e6885d2103b502aecbeab1f82081292c2b6a",
  },
  {
    file: "dist/sign/data/AlgorithmIdentifier.js",
    size: 576,
    sha256: "e9870a93ae1729b7ce237624be83cd4f8b4865739c6c82bf9da339eabebefe70",
  },
  {
    file: "dist/sign/data/Attribute.js",
    size: 535,
    sha256: "6b5000d5e698cbb774047df56d47b618d0f52e1d3316fe51b0e3673d3d422b84",
  },
  {
    file: "dist/sign/data/CertificateDataRoot.js",
    size: 1240,
    sha256: "a58f9c91bfa42f891c1c137c86970d0d77c60697d22c8244d614bd4f1e0c1cb9",
  },
  {
    file: "dist/sign/data/ContentInfo.js",
    size: 601,
    sha256: "6417eec1e56f3e7243f9205875df877f7e7a08ba42c24dc89ca7c653bc0c80f9",
  },
  {
    file: "dist/sign/data/DERObject.js",
    size: 400,
    sha256: "c50603f43a07b59bb182faf7231f8fd57c4ec49cd6e1a6a337a0492796ee8f10",
  },
  {
    file: "dist/sign/data/DigestInfo.js",
    size: 898,
    sha256: "aa9a0521c78f014ef47cf68cc5e725be7844c83c1fe3a80f2d8702c05c7e1ecd",
  },
  {
    file: "dist/sign/data/IssuerAndSerialNumber.js",
    size: 575,
    sha256: "311b44df1315e9244efeb1b6c2d9fcfba025e48d8978e69f9099c95a31cc8442",
  },
  {
    file: "dist/sign/data/KnownOids.js",
    size: 4033,
    sha256: "9da526fb885356582d831da875ee2d0c21b1fb9f38765b80fa5224f2b6553ba9",
  },
  {
    file: "dist/sign/data/ObjectIdentifier.js",
    size: 1462,
    sha256: "d36e3c2ebbae1e009994f17edcb5375aee164877d0465a00f500f59aef8d7907",
  },
  {
    file: "dist/sign/data/SignedData.js",
    size: 1319,
    sha256: "f0ee4e87e2d1404f11572c58b18cce4c7b4e080d97710a3990412c7054791f33",
  },
  {
    file: "dist/sign/data/SignerInfo.js",
    size: 1783,
    sha256: "5b7ef4d9287f19f245137404d5c39e1cd219a901d16a6b555a40a7d26c882f42",
  },
  {
    file: "dist/sign/data/SpcIndirectDataContent.js",
    size: 2791,
    sha256: "f8bfbb983b514475bc7b2632408f788dc50427ee5419daec975cddccd204f5b7",
  },
  {
    file: "dist/sign/data/SpcLink.js",
    size: 2444,
    sha256: "62fac1569d58ab853a8db68e6ff00d30b0b0e1670f761787f3020f0cd23baa44",
  },
  {
    file: "dist/sign/data/SpcPeImageData.js",
    size: 2259,
    sha256: "70fc40bf1696820bde6dbc8b530e04dc4adac229e4b0a697f7c523f9de1bda62",
  },
  {
    file: "dist/sign/data/derUtil.js",
    size: 2543,
    sha256: "b30e79ac3b83a1f9eaa66e3402deafee62e0a56e1441902c5e5c977d12501257",
  },
  {
    file: "dist/sign/index.js",
    size: 20178,
    sha256: "e0f7e3d2f94d2dee577af5678091fd5693833c715c88cd53aa7c29505fad1ab1",
  },
  {
    file: "dist/sign/timestamp.js",
    size: 5767,
    sha256: "7d1236333d00027cccca9b10b7dd20d743eabb9f8f6eaaa056695117b3fbe815",
  },
  {
    file: "dist/util/functions.js",
    size: 8732,
    sha256: "d149e217722dded20c8ab7082fcbd80189afe449ece60f258aee4d0805cb0558",
  },
  { file: "dist/version.js", size: 107, sha256: "8835a77b1596c7f3e9678edb1eaf43147896afbe7d34f5d652ac16ecb4c666fc" },
  { file: "package.json", size: 2699, sha256: "c9485f524ca28cc76490ada37c6199bc8933dd9ed573832dd1f2f2165b49ee87" },
] as const satisfies readonly LockedResourceEditorFile[]

const peLibraryFiles = [
  {
    file: "dist/NtExecutable.js",
    size: 18658,
    sha256: "31c0779b59cd0b338785ba13778695adf5f57cb774f6ea14403bdcdbc0c8570a",
  },
  {
    file: "dist/NtExecutableResource.js",
    size: 25638,
    sha256: "7d73e6436e72dd67e44bc4ff77764f99cdd569e6e10f754d61de78d69fd913be",
  },
  {
    file: "dist/format/ArrayFormatBase.js",
    size: 2513,
    sha256: "c30642d037810a3640053aab08b9c3197f1ccb151825ce1abadbef52c3ab1dc8",
  },
  {
    file: "dist/format/FormatBase.js",
    size: 677,
    sha256: "4902a09663e1628488204b07f0f816db3cbad4c3bb1531116f4dcfa26b7a4768",
  },
  {
    file: "dist/format/ImageDataDirectoryArray.js",
    size: 2551,
    sha256: "4326aaa658ec6902805cf3997e7389568b12503d45be8f130cff740e7f0ff5ab",
  },
  {
    file: "dist/format/ImageDirectoryEntry.js",
    size: 1721,
    sha256: "b4777c8ac25e12684b576227dfcfd0a6291711a764b8eff19e4b0421b85ab880",
  },
  {
    file: "dist/format/ImageDosHeader.js",
    size: 7147,
    sha256: "2d3cc6bac921a64e791eb8da2141e061275c63f52d55c5f29be25cc3d268f101",
  },
  {
    file: "dist/format/ImageFileHeader.js",
    size: 3659,
    sha256: "9f236e2441b5a9f6be354c2816b853a657ba60584067f76b400dd4faa1d991cb",
  },
  {
    file: "dist/format/ImageNtHeaders.js",
    size: 4751,
    sha256: "d368915a0f754798d78d26b3206894026dbb10c597eaf73a0e790d50d92fb6c1",
  },
  {
    file: "dist/format/ImageOptionalHeader.js",
    size: 11283,
    sha256: "6ed5ba3918553adc2262656ad6b1157c322d3a8983dac81652eedbf1717b39b9",
  },
  {
    file: "dist/format/ImageOptionalHeader64.js",
    size: 13693,
    sha256: "1f47881a86ade453271f7d75007040ce0bbd9e969e092164cac9393739d2f006",
  },
  {
    file: "dist/format/ImageSectionHeaderArray.js",
    size: 3358,
    sha256: "e718ee51aa979cd936bc576c0346fbd96adfc7271dee17f9065718267773aeec",
  },
  {
    file: "dist/format/index.js",
    size: 3371,
    sha256: "b144257c2b6307cd6e99d775f161ef556cc6b7c4ba557224d397b06a2469d0a7",
  },
  { file: "dist/index.js", size: 890, sha256: "cc96d20480ee04dcbf59220979796609e438fa921e93966459401654d86a3677" },
  { file: "dist/type/index.js", size: 79, sha256: "ef1f170ad28f2d870a474d2f96ae353d770fff5f20e642cd8f9b6f1d7742df13" },
  {
    file: "dist/util/functions.js",
    size: 9143,
    sha256: "c98747b35b9c4540391c08050768f43a2b35a05ad246727fde6825b245f1f7bb",
  },
  {
    file: "dist/util/generate.js",
    size: 6060,
    sha256: "df821e1cf955da31f67fdf167de5d778fe5a6f37b2168e4d73d74f6516b263f9",
  },
  { file: "dist/version.js", size: 107, sha256: "438073a43826171964b0826bfdd146abdf6ccaa773961567ac71084d6dd70f1b" },
  { file: "package.json", size: 2332, sha256: "0b283076c841523612eefc4b2927173da7a3772f0f924198d912ec0efe1afc2b" },
] as const satisfies readonly LockedResourceEditorFile[]

export const resourceEditorLock = {
  name: "resedit",
  version: "1.7.2",
  entry: "dist/index.mjs",
  size: 344,
  sha256: "b493ff6f14840d6e46b60b7f6e2e1f505531683c412c9bcc151b6bbf8963df77",
  graphSha256: "072beb6fe786868eed04d47cb20313e33df897eaa4618dc578758b7292a9a526",
  packages: [
    {
      name: "resedit",
      version: "1.7.2",
      entry: "dist/index.mjs",
      treeSha256: "b738241a19e98e7cd73160ff8f65bf9ac3ad2aad58c645fbfb258db374f60f20",
      files: reseditFiles,
    },
    {
      name: "pe-library",
      version: "0.4.1",
      entry: "dist/index.js",
      treeSha256: "d661c40c24e2c3c1e6ef7ac8a02534ab472e598b714efe1733cdc33053c2054f",
      files: peLibraryFiles,
    },
  ],
  dependencyJunction: {
    from: "node_modules/.bun/resedit@1.7.2/node_modules/pe-library",
    to: "node_modules/.bun/pe-library@0.4.1/node_modules/pe-library",
    resolvedEntry: "node_modules/.bun/pe-library@0.4.1/node_modules/pe-library/dist/index.js",
  },
} as const
