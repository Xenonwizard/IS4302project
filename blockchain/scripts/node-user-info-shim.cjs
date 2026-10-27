const os = require("node:os");

const nativeUserInfo = os.userInfo.bind(os);

os.userInfo = (...args) => {
  try {
    return nativeUserInfo(...args);
  } catch (error) {
    if (error && error.code !== "ERR_SYSTEM_ERROR") throw error;

    return {
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || process.env.USER || "local-user",
      homedir: process.env.USERPROFILE || process.cwd(),
      shell: null,
    };
  }
};
