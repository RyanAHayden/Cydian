// Home's User Guides, as Cydia's Home had them below More Package Sources (cydia.saurik.com/ui/ios~iphone/1.1/home/:
// Frequently Asked Questions, Copying Files to/from Device, OpenSSH Access How-To, Root Password How-To), rewritten
// for today's rootless jailbreaks. Each guide is grouped sections (nav/ui.js grouped): a header, rows, prose footer.
// Cydia's Storage Information and Developers Only are left out: there's no storage page to show.

export const JAILBREAK_INFO_URL = "https://jailbreakme.dev/";

export const GUIDES = {
  faq: {
    title: "Frequently Asked Questions",
    sections: [
      {
        header: "What is Cydian?",
        footer: "A package manager with the iOS 6 look, for modern iPhones. Jailbroken, it lists tweaks, themes and "
          + "tools from APT sources and installs them with apt. Not jailbroken, it lists apps from AltStore-style "
          + "sources, signed and installed on the phone.",
      },
      {
        header: "Do I need a jailbreak?",
        footer: "Only for tweaks and themes. Apps from AltStore-style sources work on any iPhone. Upgrading & "
          + "Jailbreaking Help says which jailbreak kinds Cydian supports.",
      },
      {
        header: "A package won't install",
        footer: "Check that Settings > Device matches your jailbreak: a package built for rootful won't install on "
          + "rootless, and the other way round. Refresh Sources, then try again. The error apt shows names the "
          + "package or dependency it couldn't get.",
      },
      {
        header: "A tweak broke something",
        footer: "Remove the last package you installed (Installed tab), then respring. If SpringBoard won't come up, "
          + "reboot: a rootless jailbreak starts out unjailbroken after a reboot. Jailbreak again with tweaks turned "
          + "off (Dopamine: Tweak Injection in its settings), then remove the package.",
      },
      {
        header: "Adding a source",
        footer: "Sources > Edit > Add, then type the source's address. More Package Sources on Home lists a few to "
          + "start with.",
      },
    ],
  },
  copying: {
    title: "Copying Files",
    sections: [
      {
        header: "On the Phone",
        footer: "Filza File Manager browses the whole file system, unzips archives and edits plists. Install the "
          + "build for your jailbreak.",
      },
      {
        header: "From a Computer",
        footer: "With OpenSSH installed (see OpenSSH Access How-To), any SFTP app can copy files both ways: Finder "
          + "with an SFTP add-on or Cyberduck on a Mac, WinSCP on Windows, FileZilla anywhere. Connect to the "
          + "phone's IP address as mobile, on port 22.",
      },
      {
        header: "Without a Jailbreak",
        footer: "The Files app reaches the documents of apps that share them. On a computer, Finder (or iTunes on "
          + "Windows) shows the same under the phone's Files tab.",
      },
    ],
  },
  openssh: {
    title: "OpenSSH",
    sections: [
      { header: "1. Install OpenSSH", footer: "Search for OpenSSH and install it. It starts on its own." },
      { header: "2. Find the IP Address", footer: "Settings > Wi-Fi, tap ⓘ beside your network: IP Address." },
      {
        header: "3. Connect",
        footer: "On a computer on the same Wi-Fi, open Terminal (PowerShell on Windows) and type ssh mobile@ "
          + "followed by the address, for example ssh mobile@192.168.1.20. Accept the host key the first time.",
      },
      {
        header: "4. Log In",
        footer: "Use the password you set for mobile when you jailbroke (Dopamine and palera1n ask for one). Older "
          + "jailbreaks used alpine: if that works, change it now (Root Password How-To). Use sudo for commands "
          + "that need root.",
      },
    ],
  },
  password: {
    title: "Root Password",
    sections: [
      {
        footer: "Anyone on your Wi-Fi can try to log in once OpenSSH is installed, so the passwords mustn't be the "
          + "well-known alpine. Run these over SSH or in a terminal app on the phone, such as NewTerm.",
      },
      { header: "1. mobile's Password", footer: "Type passwd, then your current password and the new one twice." },
      {
        header: "2. root's Password",
        footer: "Type sudo passwd root, then mobile's password and root's new one twice. On a rootless jailbreak "
          + "root can't log in over SSH: you log in as mobile and use sudo.",
      },
      { header: "3. Done", footer: "Type exit to close the session." },
    ],
  },
};

// Home's User Guides group: one row per guide, in Cydia's order.
export const guideRows = (format) => [
  { label: "Frequently Asked Questions", href: format({ tab: "home", path: ["guides", "faq"] }) },
  { label: "Copying Files to/from Device", href: format({ tab: "home", path: ["guides", "copying"] }) },
  { label: "OpenSSH Access How-To", href: format({ tab: "home", path: ["guides", "openssh"] }) },
  { label: "Root Password How-To", href: format({ tab: "home", path: ["guides", "password"] }) },
];
