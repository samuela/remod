#!/usr/bin/env node

import { spawnSync } from "child_process";
import { statSync } from "fs";
import { userInfo } from "os";
import { resolve } from "path";

import figures from "figures";
import { AppContext, Box, Color, render, StdinContext, Text } from "ink";
import meow from "meow";
import React, { useEffect, useState } from "react";

// @ts-ignore
import { groupname, username } from "userid";

const ARROW_UP = "\u001B[A";
const ARROW_DOWN = "\u001B[B";
const ARROW_LEFT = "\u001B[D";
const ARROW_RIGHT = "\u001B[C";
const ENTER = "\r";
const SPACE = " ";

interface IRWX {
  read: boolean;
  write: boolean;
  execute: boolean;
}
interface ISpecial {
  setuid: boolean;
  setgid: boolean;
  stickybit: boolean;
}
interface IPermissionsState {
  uid: number;
  gid: number;
  // There are actually a bunch of options here, see `man ls`.
  type: "file" | "directory";
  special: ISpecial;
  user: IRWX;
  group: IRWX;
  other: IRWX;
}

function lsRender(perms: IPermissionsState) {
  function rwxRender(rwx: IRWX, special: boolean, specialChar: string) {
    const readChar = rwx.read ? "r" : "-";
    const writeChar = rwx.write ? "w" : "-";

    let executeChar;
    if (!rwx.execute && !special) {
      executeChar = "-";
    } else if (!rwx.execute && special) {
      executeChar = specialChar.toUpperCase();
    } else if (rwx.execute && !special) {
      executeChar = "x";
    } else {
      executeChar = specialChar;
    }

    return readChar + writeChar + executeChar;
  }

  const dirChar = perms.type === "directory" ? "d" : "-";

  return (
    dirChar +
    rwxRender(perms.user, perms.special.setuid, "s") +
    rwxRender(perms.group, perms.special.setgid, "s") +
    rwxRender(perms.other, perms.special.stickybit, "t")
  );
}

function octalRender(perms: IPermissionsState): string {
  function o(rwx: IRWX) {
    return (+rwx.read * 4 + +rwx.write * 2 + +rwx.execute * 1).toString();
  }
  const { setuid, setgid, stickybit } = perms.special;
  // tslint:disable-next-line:max-line-length
  // See https://stackoverflow.com/questions/7820683/convert-boolean-result-into-number-integer
  const special = (+setuid * 4 + +setgid * 2 + +stickybit * 1).toString();
  return special + o(perms.user) + o(perms.group) + o(perms.other);
}

function chmodDiff(
  before: IPermissionsState,
  after: IPermissionsState,
): string {
  interface IDiffSet {
    added: string[];
    removed: string[];
  }
  const user: IDiffSet = { added: [], removed: [] };
  const group: IDiffSet = { added: [], removed: [] };
  const other: IDiffSet = { added: [], removed: [] };
  const etc: IDiffSet = { added: [], removed: [] };

  function process(beforeRWX: IRWX, afterRWX: IRWX, diff: IDiffSet) {
    if (beforeRWX.read !== afterRWX.read) {
      (beforeRWX.read ? diff.removed : diff.added).push("r");
    }
    if (beforeRWX.write !== afterRWX.write) {
      (beforeRWX.write ? diff.removed : diff.added).push("w");
    }
    if (beforeRWX.execute !== afterRWX.execute) {
      (beforeRWX.execute ? diff.removed : diff.added).push("x");
    }
  }
  process(before.user, after.user, user);
  process(before.group, after.group, group);
  process(before.other, after.other, other);

  if (before.special.setuid !== after.special.setuid) {
    (before.special.setuid ? user.removed : user.added).push("s");
  }
  if (before.special.setgid !== after.special.setgid) {
    (before.special.setgid ? group.removed : group.added).push("s");
  }
  if (before.special.stickybit !== after.special.stickybit) {
    (before.special.stickybit ? etc.removed : etc.added).push("t");
  }

  function renderSet(diff: IDiffSet, groupShort: string) {
    if (diff.added.length + diff.removed.length > 0) {
      return [
        groupShort +
          ((diff.added.length > 0 ? "+" + diff.added.join("") : "") +
            (diff.removed.length > 0 ? "-" + diff.removed.join("") : "")),
      ];
    } else {
      return [];
    }
  }

  return ([] as string[])
    .concat(
      ...[
        renderSet(user, "u"),
        renderSet(group, "g"),
        renderSet(other, "o"),
        renderSet(etc, ""),
      ],
    )
    .join(",");
}

function permissionsFromOctalString(
  octal: string,
): { user: IRWX; group: IRWX; other: IRWX; special: ISpecial } {
  const [specialN, userN, groupN, otherN] = octal.split("").map(Number);

  const special = {
    setuid: (specialN & 4) > 0,
    setgid: (specialN & 2) > 0,
    stickybit: (specialN & 1) > 0,
  };

  function parseRWX(n: number): IRWX {
    return {
      read: (n & 4) > 0,
      write: (n & 2) > 0,
      execute: (n & 1) > 0,
    };
  }

  return {
    special,
    user: parseRWX(userN),
    group: parseRWX(groupN),
    other: parseRWX(otherN),
  };
}

function filePermissions(filename: string): IPermissionsState {
  const filestat = statSync(filename);

  let type: "file" | "directory";
  if (filestat.isFile()) {
    type = "file";
  } else if (filestat.isDirectory()) {
    type = "directory";
  } else {
    throw new Error("unsupported file type");
  }

  return {
    uid: filestat.uid,
    gid: filestat.gid,
    type,
    ...permissionsFromOctalString(
      (filestat.mode & parseInt("7777", 8)).toString(8).padStart(4, "0"),
    ),
  };
}

function Checkbox(props: {
  hover: boolean;
  name: string;
  current: boolean;
  original: boolean;
}) {
  const radio = props.current ? figures.radioOn : figures.radioOff;
  // const radio = props.selected ? "[x]" : "[ ]";
  // const edited = props.original === props.current ? "" : "(*)";
  // const edited = props.original === props.current ? "" : figures.warning;
  const edited = props.original === props.current ? "" : "✎";
  if (props.hover) {
    return (
      <Box textWrap="truncate">
        <Color magenta>
          {figures.pointer} {radio} {props.name} {edited}
        </Color>
      </Box>
    );
  } else {
    return (
      <Box textWrap="truncate">
        <Color>
          {"  "}
          {radio} {props.name} {edited}
        </Color>
      </Box>
    );
  }
}

function PermissionsEditor(props: {
  stdin: NodeJS.ReadStream;
  originalPermissions: IPermissionsState;
  currentPermissions: IPermissionsState;
  setCurrentPermissions: React.Dispatch<
    React.SetStateAction<IPermissionsState>
  >;
  hover: boolean;
}) {
  const [cursor, setCursor] = useState({ row: 0, col: 0 });

  function toggleRWX(row: number, rwx: IRWX): IRWX {
    const rwx2 = { ...rwx };
    if (row === 0) {
      rwx2.read = !rwx2.read;
    } else if (row === 1) {
      rwx2.write = !rwx2.write;
    } else if (row === 2) {
      rwx2.execute = !rwx2.execute;
    } else {
      throw new Error("row was out of range");
    }
    return rwx2;
  }

  function handleInput(data: string) {
    if (data === ARROW_UP) {
      setCursor({ ...cursor, row: Math.max(0, cursor.row - 1) });
    } else if (data === ARROW_DOWN) {
      setCursor({ ...cursor, row: Math.min(2, cursor.row + 1) });
    } else if (data === ARROW_LEFT) {
      setCursor({ ...cursor, col: Math.max(0, cursor.col - 1) });
    } else if (data === ARROW_RIGHT) {
      setCursor({ ...cursor, col: Math.min(3, cursor.col + 1) });
    } else if (data === SPACE) {
      if (cursor.col === 0) {
        props.setCurrentPermissions({
          ...props.currentPermissions,
          user: toggleRWX(cursor.row, props.currentPermissions.user),
        });
      } else if (cursor.col === 1) {
        props.setCurrentPermissions({
          ...props.currentPermissions,
          group: toggleRWX(cursor.row, props.currentPermissions.group),
        });
      } else if (cursor.col === 2) {
        props.setCurrentPermissions({
          ...props.currentPermissions,
          other: toggleRWX(cursor.row, props.currentPermissions.other),
        });
      } else if (cursor.col === 3) {
        const special = { ...props.currentPermissions.special };
        if (cursor.row === 0) {
          special.setuid = !special.setuid;
        } else if (cursor.row === 1) {
          special.setgid = !special.setgid;
        } else if (cursor.row === 2) {
          special.stickybit = !special.stickybit;
        } else {
          throw new Error("row was out of range");
        }
        props.setCurrentPermissions({ ...props.currentPermissions, special });
      } else {
        throw new Error("col was out of range");
      }
    }
  }

  useEffect(() => {
    props.stdin.on("data", handleInput);

    return () => {
      props.stdin.removeListener("data", handleInput);
    };
  });

  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1}>
      <Box flexDirection="column" width={15} marginLeft={2}>
        <Text>
          {"  "}
          <Color underline>User</Color>
        </Text>
        <Checkbox
          name="read"
          hover={props.hover && cursor.row === 0 && cursor.col === 0}
          current={props.currentPermissions.user.read}
          original={props.originalPermissions.user.read}
        />
        <Checkbox
          name="write"
          hover={props.hover && cursor.row === 1 && cursor.col === 0}
          current={props.currentPermissions.user.write}
          original={props.originalPermissions.user.write}
        />
        <Checkbox
          name="execute"
          hover={props.hover && cursor.row === 2 && cursor.col === 0}
          current={props.currentPermissions.user.execute}
          original={props.originalPermissions.user.execute}
        />
      </Box>
      <Box flexDirection="column" width={15} marginLeft={4}>
        <Text>
          {"  "}
          <Color underline>Group</Color>
        </Text>
        <Checkbox
          name="read"
          hover={props.hover && cursor.row === 0 && cursor.col === 1}
          current={props.currentPermissions.group.read}
          original={props.originalPermissions.group.read}
        />
        <Checkbox
          name="write"
          hover={props.hover && cursor.row === 1 && cursor.col === 1}
          current={props.currentPermissions.group.write}
          original={props.originalPermissions.group.write}
        />
        <Checkbox
          name="execute"
          hover={props.hover && cursor.row === 2 && cursor.col === 1}
          current={props.currentPermissions.group.execute}
          original={props.originalPermissions.group.execute}
        />
      </Box>
      <Box flexDirection="column" width={15} marginLeft={4}>
        <Text>
          {"  "}
          <Color underline>Others</Color>
        </Text>
        <Checkbox
          name="read"
          hover={props.hover && cursor.row === 0 && cursor.col === 2}
          current={props.currentPermissions.other.read}
          original={props.originalPermissions.other.read}
        />
        <Checkbox
          name="write"
          hover={props.hover && cursor.row === 1 && cursor.col === 2}
          current={props.currentPermissions.other.write}
          original={props.originalPermissions.other.write}
        />
        <Checkbox
          name="execute"
          hover={props.hover && cursor.row === 2 && cursor.col === 2}
          current={props.currentPermissions.other.execute}
          original={props.originalPermissions.other.execute}
        />
      </Box>
      <Box flexDirection="column" width={22} marginLeft={4}>
        <Text>
          {"  "}
          <Color underline>Special</Color>
        </Text>
        <Checkbox
          name="setuid"
          hover={props.hover && cursor.row === 0 && cursor.col === 3}
          current={props.currentPermissions.special.setuid}
          original={props.originalPermissions.special.setuid}
        />
        <Checkbox
          name="setgid"
          hover={props.hover && cursor.row === 1 && cursor.col === 3}
          current={props.currentPermissions.special.setgid}
          original={props.originalPermissions.special.setgid}
        />
        <Checkbox
          name="sticky bit"
          hover={props.hover && cursor.row === 2 && cursor.col === 3}
          current={props.currentPermissions.special.stickybit}
          original={props.originalPermissions.special.stickybit}
        />
      </Box>
    </Box>
  );
}

function Diff(props: {
  before: IPermissionsState;
  after: IPermissionsState;
  providedPath: string;
}) {
  const diff = chmodDiff(props.before, props.after);
  return (
    <Box flexDirection="column">
      <Color dim underline>
        Diff
      </Color>
      <Text>
        {"  "}
        {diff === "" ? (
          <Color italic>no change</Color>
        ) : (
          <Text>
            <Color dim>chmod</Color> {diff}{" "}
            <Color dim>{props.providedPath}</Color>
          </Text>
        )}
      </Text>
    </Box>
  );
}

function BeforeAfter(props: { permissions: IPermissionsState }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Color dim>User:</Color> {username(props.permissions.uid)}
        {userInfo().uid === props.permissions.uid ? (
          <Color green> (that's you!)</Color>
        ) : (
          <Color red> (not you)</Color>
        )}
      </Box>
      <Box>
        <Color dim>Group:</Color> {groupname(props.permissions.gid)}
      </Box>
      <Box>
        <Color dim>Octal:</Color> {octalRender(props.permissions)}
      </Box>
      <Box>
        <Color dim>Long format:</Color> {lsRender(props.permissions)}
      </Box>
    </Box>
  );
}

function Base(props: {
  providedPath: string;
  initialOctalPerms: string;
  stdin: NodeJS.ReadStream;
  setRawMode: (mode: boolean) => void;
  exit: () => void;
}) {
  const absolutePath = resolve(props.providedPath);
  const originalPermissions = filePermissions(absolutePath);
  const [currentPermissions, setCurrentPermissions] = useState(
    props.initialOctalPerms === ""
      ? originalPermissions
      : {
          ...originalPermissions,
          ...permissionsFromOctalString(
            props.initialOctalPerms.padStart(4, "0"),
          ),
        },
  );
  const [currentHover, setCurrentHover] = useState("editor");

  function handleInput(data: string) {
    if (data === ENTER) {
      setCurrentHover("none");
      console.log();
      const diff = chmodDiff(originalPermissions, currentPermissions);
      if (diff.length === 0) {
        console.log("No difference!");
      } else {
        // Use spawnSync instead of the builtin since the builtin doesn't
        // support special flags.
        const res = spawnSync("chmod", [diff, props.providedPath]);
        if (res.status !== 0) {
          console.error(
            "Something went wrong running chmod! Are you sure you're allowed " +
              "to change these permissions?",
          );
          console.error();
          console.error(res.stderr.toString());
        } else {
          console.log("Changes applied!");
        }
      }
      props.exit();
    }
  }

  useEffect(() => {
    props.setRawMode(true);
    props.stdin.on("data", handleInput);

    return () => {
      props.stdin.removeListener("data", handleInput);
      props.setRawMode(false);
    };
  });

  return (
    <Box flexDirection="column">
      <Box height={2}>
        <Color dim>File:</Color> {absolutePath}
      </Box>
      <Box flexDirection="row" marginBottom={1}>
        <Box flexGrow={1} flexDirection="column">
          <Color underline dim>
            Before
          </Color>
          <BeforeAfter permissions={originalPermissions} />
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <Color underline dim>
            After
          </Color>
          <BeforeAfter permissions={currentPermissions} />
        </Box>
      </Box>
      <Diff
        before={originalPermissions}
        after={currentPermissions}
        providedPath={props.providedPath}
      />
      <PermissionsEditor
        stdin={props.stdin}
        originalPermissions={originalPermissions}
        currentPermissions={currentPermissions}
        setCurrentPermissions={setCurrentPermissions}
        hover={currentHover === "editor"}
      />
      <Box flexDirection="column">
        <Color underline dim>
          Flight manual
        </Color>
        <Color dim>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              {figures.arrowLeft} {figures.arrowUp} {figures.arrowRight}{" "}
              {figures.arrowDown} {"    "}to move around
            </Text>
            <Text>
              <Color italic>space</Color> {"      "}to toggle
            </Text>
            <Text>
              <Color italic>enter</Color> {"      "}to apply changes
            </Text>
            <Text>
              <Color italic>ctrl-c</Color> {"     "}to cancel
            </Text>
          </Box>
        </Color>
      </Box>
    </Box>
  );
}

const CLI_USAGE = `
remod - chmod for human beings! 💁‍♀️

Usage
  $ remod <file>
  $ remod <octal> <file>

Examples
  $ remod unicorns.txt
  $ remod 755 unicorns.txt
`;

function main() {
  const cliArgs = meow(CLI_USAGE, {});

  let providedPath = "";
  let initialOctalPerms = "";
  if (cliArgs.input.length === 0) {
    console.log(CLI_USAGE);
    process.exit(0);
  } else if (cliArgs.input.length === 1) {
    providedPath = cliArgs.input[0];
  } else if (cliArgs.input.length === 2) {
    initialOctalPerms = cliArgs.input[0];
    providedPath = cliArgs.input[1];
  } else {
    console.error("Unexpected arguments!");
    process.exit(1);
  }

  render(
    <AppContext.Consumer>
      {({ exit }) => (
        <StdinContext.Consumer>
          {({ stdin, setRawMode }) => {
            if (setRawMode === undefined) {
              throw new Error("setRawMode was undefined");
            }
            return (
              <Base
                providedPath={providedPath}
                initialOctalPerms={initialOctalPerms}
                stdin={stdin}
                setRawMode={setRawMode}
                exit={exit}
              />
            );
          }}
        </StdinContext.Consumer>
      )}
    </AppContext.Consumer>,
  );
}

main();
