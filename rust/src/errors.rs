use std::error::Error;
use std::fmt;

/// A mistake on the command line: reported as `error: <message>` followed by
/// the help text, with exit code 2.
#[derive(Debug)]
pub struct UsageError(pub String);

impl fmt::Display for UsageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl Error for UsageError {}
